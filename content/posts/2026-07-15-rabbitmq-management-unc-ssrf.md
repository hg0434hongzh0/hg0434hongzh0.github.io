---
title: RabbitMQ 管理插件绝对路径遍历导致 UNC SSRF（CVE-2026-57211）
date: 2026-07-15
publishedAt: 2026-07-15T00:54:04+08:00
category: 漏洞分析
summary: 分析 RabbitMQ Management 多静态目录预探测逻辑如何在 Cowboy 路径校验前解析 Windows UNC 路径，触发出站 SMB 认证并泄露 NetNTLMv2 凭据材料。
slug: rabbitmq-management-unc-ssrf
coverText: RabbitMQ
badge: 定风波Agent复现
published: true
---

> **实验说明：** 本文仅记录授权测试环境中的漏洞复现与代码审计过程。请勿对未授权目标发送测试请求；建议在隔离的 Windows 虚拟机和受控网络中完成验证，并避免将 SMB 服务暴露到非实验网络。

## 基本信息

- **CVE编号:** CVE-2026-57211

- **漏洞命名:** RabbitMQ 管理插件静态文件处理器绝对路径遍历导致UNC SSRF漏洞

- **披露日期:** 2026-06-18

- **更新日期:** 2026-07-10

- **CVSS评分:** 6.5（MEDIUM）

- **漏洞发现者:** nvn1729


## 受影响版本

- RabbitMQ Server >= 4.1.0, < 4.1.11（Windows平台）

- RabbitMQ Server >= 4.2.0, < 4.2.6（Windows平台）

- **不受影响:** RabbitMQ Server < 4.1.0（不含存在漏洞的代码分支）；Linux/macOS平台（UNC路径无意义，操作系统层不解析）

- **修复版本:** 4.1.11、4.2.6


## 漏洞描述

RabbitMQ是一个由Broadcom开发和维护的开源消息队列与流处理中间件，支持AMQP、MQTT、STOMP等多种协议。其管理插件（rabbitmq_management）提供基于HTTP的Web管理UI和REST API，默认监听端口15672，用于查看队列状态、管理交换机、监控集群等运维操作。

该漏洞源于管理插件的静态文件处理器 `rabbit_mgmt_wm_static.erl` 在处理URL路径时，在Cowboy框架的 `cowboy_static` 模块执行路径校验（包括保留字符过滤、`..`序列解析和目录包含检查）之前，先将URL解码后的用户输入拼接到文件路径并传递给Erlang的 `erl_prim_loader:read_file_info/1` 函数。当 `LocalPaths` 中存在两个或以上静态目录时（通常是核心 `rabbitmq_management` 再加至少一个管理扩展插件），代码走多元素分支，URL编码的反斜杠 `%5C` 被Cowboy路由器解码为 `\`，通过 `filename:join/1` 拼接时被Windows文件系统解释为UNC路径（如 `\\attacker_host\share`），最终通过Erlang NIF `prim_file` 调用Windows API `GetFullPathNameW`和 `GetFileAttributesW`。在域内Windows主机上，此过程导致机器账户自动向攻击者控制的SMB服务器进行NTLM认证，泄露NTLMv2哈希，理论上攻击者可利用泄露的NTLMv2哈希发起NTLM Relay攻击实现横向移动甚至域权限提升。攻击无需认证，攻击复杂度较高。

## 漏洞复现

以下为定风波 Agent 基于 DeepSeek 在隔离测试环境中的自动化复现结果：

<img src="/assets/posts/rabbitmq-management-unc-ssrf/f084b21a610117d377d8668b030ba4d4.png" data-gitee-file="f084b21a610117d377d8668b030ba4d4.png" alt="Windows 环境漏洞复现与 SMB 回连证据">

<img src="/assets/posts/rabbitmq-management-unc-ssrf/20260714224054583.png" data-gitee-file="20260714224054583.png" alt="隔离环境中的漏洞复现结果">



## 漏洞分析

### 1. 从路由入口定位静态文件处理器

先从管理插件的路由入口看起。在 `deps/rabbitmq_management/src/rabbit_mgmt_dispatcher.erl` 中，`build_dispatcher/1` 会调用 `build_routes/1` 生成路由表，再交给 `cowboy_router:compile/1` 编译：

```erlang
build_dispatcher(Ignore) ->
    Routes = build_routes(Ignore),
    cowboy_router:compile(Routes).
```

`build_routes/1` 中和本漏洞关系最直接的代码如下：

```erlang
build_routes(Ignore) ->
    ManagementApp = module_app(?MODULE),
    Prefix = rabbit_mgmt_util:get_path_prefix(),
    RootIdxRtes = build_root_index_routes(Prefix, ManagementApp),
    ApiRdrRte = build_redirect_route("/api", Prefix ++ "/api/index.html"),
    CliRdrRte = build_redirect_route("/cli", Prefix ++ "/cli/index.html"),
    StatsRdrRte1 = build_redirect_route("/stats", Prefix ++ "/api/index.html"),
    StatsRdrRte2 = build_redirect_route("/doc/stats.html", Prefix ++ "/api/index.html"),
    MgmtRdrRte = {"/mgmt", rabbit_mgmt_wm_redirect, "/"},
    LocalPaths = [{module_app(M), "www"} || M <- modules(Ignore)],
    LocalStaticRte = {"/[...]", rabbit_mgmt_wm_static, LocalPaths},
    OauthBootstrap = build_oauth_bootstrap_route(Prefix),
    % NB: order is significant in the routing list
    Routes0 = build_module_routes(Ignore) ++
        [ApiRdrRte, CliRdrRte, MgmtRdrRte, StatsRdrRte1, StatsRdrRte2, LocalStaticRte],
    Routes1 = maybe_add_path_prefix(Routes0, Prefix),
    % NB: ensure the root routes are first
    Routes2 = RootIdxRtes ++ OauthBootstrap ++
        maybe_add_path_prefix([{"/login", rabbit_mgmt_login, []}], Prefix) ++ Routes1,
    [{'_', Routes2}].
```

Cowboy 的单条路由是 `{Path, Handler, HandlerArgs}` 三元组，最外层的 `{'_', Routes2}` 表示这些路径规则适用于任意 Host。路由按照列表顺序匹配，因此具体的 API、登录和 OAuth 路由必须排在 `"/[...]"` 这种兜底路由之前。

### 2. 首页路由和 `management.path_prefix`

```erlang
ManagementApp = module_app(?MODULE),
Prefix = rabbit_mgmt_util:get_path_prefix(),
RootIdxRtes = build_root_index_routes(Prefix, ManagementApp),
```

`module_app(?MODULE)` 用于确定当前模块所属的 OTP Application，正常情况下得到 `rabbitmq_management`。`Prefix` 则根据下图判定来自 `management.path_prefix` 配置，用于把管理界面挂载到指定的 URL 前缀下。

<img src="/assets/posts/rabbitmq-management-unc-ssrf/20260715000506783.png" data-gitee-file="20260715000506783.png" alt="RabbitMQ Management 路由构建逻辑">
<img src="/assets/posts/rabbitmq-management-unc-ssrf/20260715000928099.png" data-gitee-file="20260715000928099.png" alt="management.path_prefix 配置读取逻辑">

这里需要注意，下面第一个函数子句中的空字符串表示“没有配置路径前缀”，并不是“请求路径为空”：

```erlang
build_root_index_routes("", ManagementApp) ->
    [{"/", rabbit_mgmt_wm_static, root_idx_file(ManagementApp)}];
build_root_index_routes(Prefix, ManagementApp) ->
    [{"/", rabbit_mgmt_wm_redirect, Prefix ++ "/"},
     {Prefix, rabbit_mgmt_wm_static, root_idx_file(ManagementApp)}].

root_idx_file(ManagementApp) ->
    {priv_file, ManagementApp, "www/index.html"}.
```

未配置 Prefix 时，访问 `/` 会由 `rabbit_mgmt_wm_static` 返回 `rabbitmq_management` Application 的 `priv/www/index.html`。假设配置：

```ini
management.path_prefix = /rabbitmq
```

则 `/` 会先重定向到 `/rabbitmq/`，再由静态文件处理器返回同一个首页文件。`rabbit_mgmt_util:get_path_prefix()` 读取的是经过 RabbitMQ 配置 Schema 映射后的 Application 环境变量，因此配置文件中的字段名和代码里最终读取的环境变量名不完全一致属于正常现象，对本漏洞没有影响。



### 3. API 路由、重定向路由和静态资源兜底路由

`build_module_routes/1` 会收集所有实现 `rabbit_mgmt_extension` behaviour 的管理扩展模块，调用各模块的 `dispatcher/0`，然后统一在相对路径前增加 `/api`：

```erlang
build_module_routes(Ignore) ->
    Routes = [Module:dispatcher() || Module <- modules(Ignore)],
    [{"/api" ++ Path, Mod, Args} ||
        {Path, Mod, Args} <- lists:append(Routes)].
```

例如扩展模块声明：

```erlang
{"/overview", rabbit_mgmt_wm_overview, []}
```

最终会变成：

```text
/api/overview -> rabbit_mgmt_wm_overview
```

`maybe_add_path_prefix/2` 随后再给这些路由增加可选的管理路径前缀：

```erlang
maybe_add_path_prefix(Routes, "") ->
    Routes;
maybe_add_path_prefix(Routes, Prefix) ->
    [{Prefix ++ Path, Mod, Args} || {Path, Mod, Args} <- Routes].
```

所以配置 `/rabbitmq` 后，上面的 API 路由会变成 `/rabbitmq/api/overview`。`/api`、`/cli`、`/stats` 等兼容路径也只是通过 `rabbit_mgmt_wm_redirect` 跳转到对应的 HTML 页面。

真正和漏洞入口直接相关的是下面两行：

```erlang
LocalPaths = [{module_app(M), "www"} || M <- modules(Ignore)],
LocalStaticRte = {"/[...]", rabbit_mgmt_wm_static, LocalPaths},
```

`LocalPaths` 收集每个已启用管理扩展所属 Application 的 `priv/www` 静态资源目录。例如同时启用 Management、Shovel Management 和 Federation Management 时，逻辑上会形成类似列表：

```erlang
[
    {rabbitmq_management, "www"},
    {rabbitmq_shovel_management, "www"},
    {rabbitmq_federation_management, "www"}
]
```

`"/[...]"` 是 Cowboy 的剩余路径通配路由。前面没有被 API、登录、OAuth 或重定向规则匹配的请求，都会落到：

```erlang
rabbit_mgmt_wm_static:init(Req, LocalPaths)
```

例如 `/js/dispatcher.js`、`/css/main.css` 会通过这条路由在各扩展的 `priv/www` 目录中查找。由于该规则能够接收任意剩余路径，它也成为了未认证攻击请求进入静态文件处理器的入口。

<img src="/assets/posts/rabbitmq-management-unc-ssrf/20260714231612111.png" data-gitee-file="20260714231612111.png" alt="静态资源通配路由与处理器定位">

如果未配置 Prefix，和本漏洞有关的最终路由可简化为：

```erlang
[
    {'_', [
        {"/", rabbit_mgmt_wm_static,
              {priv_file, rabbitmq_management, "www/index.html"}},
        {"/login", rabbit_mgmt_login, []},
        {"/api/overview", rabbit_mgmt_wm_overview, []},
        {"/[...]", rabbit_mgmt_wm_static, LocalPaths}
    ]}
].
```

如果 Prefix 为 `/rabbitmq`，静态兜底路由则变成：

```erlang
{"/rabbitmq/[...]", rabbit_mgmt_wm_static, LocalPaths}
```

因此攻击请求需要相应地发送到 Prefix 下。路径前缀只改变路由入口，不会消除后续静态文件探测逻辑中的漏洞。

### 4. 多静态目录分支提前访问了用户可控路径

继续跟进 `deps/rabbitmq_management/src/rabbit_mgmt_wm_static.erl`：

```erlang
init(Req0, {priv_file, _App, _Path}=Opts) ->
    Req1 = rabbit_mgmt_headers:set_common_permission_headers(Req0, ?MODULE),
    cowboy_static:init(Req1, Opts);
init(Req0, [{App, Path}]) ->
    Req1 = rabbit_mgmt_headers:set_common_permission_headers(Req0, ?MODULE),
    do_init(Req1, App, Path);
init(Req0, [{App, Path}|Tail]) ->
    Req1 = rabbit_mgmt_headers:set_common_permission_headers(Req0, ?MODULE),
    PathInfo = cowboy_req:path_info(Req1),
    Filepath = filename:join([code:priv_dir(App), Path|PathInfo]),
    %% We use erl_prim_loader because the file may be inside an .ez archive.
    FileInfo = erl_prim_loader:read_file_info(binary_to_list(Filepath)),
    case FileInfo of
        {ok, #file_info{type = regular}} -> do_init(Req1, App, Path);
        {ok, #file_info{type = symlink}} -> do_init(Req1, App, Path);
        _                                -> init(Req0, Tail)
    end.

do_init(Req, App, Path) ->
    cowboy_static:init(Req, {priv_dir, App, Path}).
```

<img src="/assets/posts/rabbitmq-management-unc-ssrf/20260714225723596.png" data-gitee-file="20260714225723596.png" alt="rabbit_mgmt_wm_static 多目录文件探测分支">

这里有三条分支：

1. **首页的 `{priv_file, App, Path}` 分支**：直接交给 `cowboy_static:init/2` 处理。
2. **`LocalPaths` 只有一个元素的分支**：同样直接调用 `do_init/3`，再进入 `cowboy_static:init/2`。
3. **`LocalPaths` 至少有两个元素的分支**：为了判断请求的静态文件属于哪个扩展目录，代码会先自行拼接文件路径并调用 `erl_prim_loader:read_file_info/1` 检查文件是否存在；找不到时再递归检查下一个 Application。

漏洞恰好位于第三条分支。只启用一个静态资源目录时，请求会直接进入 Cowboy 的静态文件处理流程；`LocalPaths` 至少包含两个元素后，`[{App, Path}|Tail]` 会匹配成功，RabbitMQ 会在调用 `cowboy_static:init/2` 之前执行：

```erlang
PathInfo = cowboy_req:path_info(Req1),
Filepath = filename:join([code:priv_dir(App), Path|PathInfo]),
erl_prim_loader:read_file_info(binary_to_list(Filepath)).
```

其中 `PathInfo` 来自请求 URL，攻击者可以控制。经 Cowboy 路由解析和 URL 解码后，编码的反斜杠能够进入路径片段；在 Windows 上，形如 `\\attacker\share` 的路径会被解释为 UNC 网络路径。危险点不是最终是否成功读取到静态文件，而是 `read_file_info/1` 为了查询文件属性，已经把该路径交给底层文件系统处理。

换句话说，正常的安全边界应当是：

```text
用户路径 -> Cowboy 校验/规范化 -> 访问文件系统
```

实际的多目录分支却变成：

```text
用户路径
  -> cowboy_req:path_info/1
  -> filename:join/1
  -> erl_prim_loader:read_file_info/1
  -> Cowboy 静态文件校验
```

在 Cowboy 对保留字符、路径规范化和目录边界完成检查之前，RabbitMQ 已经对攻击者构造的路径执行了一次真实的文件系统探测，这就是漏洞的核心。

### 5. UNC SSRF 与 NTLM 凭据泄露链路

在 Windows 上，当待探测路径被解析为 UNC 路径时，文件属性查询可能触发到远程 SMB 服务的网络访问。完整调用链可以概括为：

```text
未认证 HTTP 请求
  -> Cowboy "/[...]" 通配路由
  -> rabbit_mgmt_wm_static:init/2 多目录分支
  -> cowboy_req:path_info/1 取得已解码路径片段
  -> filename:join/1 拼接路径
  -> erl_prim_loader:read_file_info/1
  -> prim_file / Windows 文件 API
  -> 访问攻击者控制的 UNC/SMB 地址
  -> 触发 NTLM 认证
```

因此它虽然从“静态文件查找”出发，实际造成的不是传统意义上把任意本地文件内容返回给攻击者，而是利用 Windows 对 UNC 路径的自动网络访问行为形成 SSRF，并可能泄露 RabbitMQ 服务进程身份对应的 NetNTLMv2 认证材料。在域环境中，如果 RabbitMQ 服务以域账户或机器账户权限运行，泄露材料还可能被用于离线破解或在满足条件时进行 NTLM Relay。

### 6. 为什么 `LocalPaths` 必须至少包含两个元素

漏洞触发条件中的“至少两个静态资源目录”直接来自 Erlang 的模式匹配。这里的数量包含核心 `rabbitmq_management` 本身，因此常见场景是启用 Management 插件后，再启用任意一个会贡献 Web 静态资源的管理扩展：

```erlang
init(Req0, [{App, Path}]) ->
    %% 列表只有一个元素，不执行 read_file_info/1
    do_init(Req1, App, Path);

init(Req0, [{App, Path}|Tail]) ->
    %% Tail 非空，即至少两个元素，提前探测拼接后的路径
    FileInfo = erl_prim_loader:read_file_info(...).
```

因此应当区分：

- “管理插件已启用”负责暴露静态文件路由；
- “至少存在两个静态资源目录”负责进入存在缺陷的手工文件探测分支；
- “运行于 Windows”负责把构造路径解释为 UNC 地址并产生 SMB 网络访问。

三者共同构成该漏洞的关键触发条件。


## 修复方案

升级到官方修复版本，并根据当前使用的版本分支选择对应版本：

### `4.2.x` 分支

```powershell
# Chocolatey
choco upgrade rabbitmq --version=4.2.6
```

```bash
# Docker
docker pull rabbitmq:4.2.6-management
```

### `4.1.x` 分支

```powershell
# Chocolatey
choco upgrade rabbitmq --version=4.1.11
```

```bash
# Docker
docker pull rabbitmq:4.1.11-management
```

使用 Windows 安装包部署时，可以从 RabbitMQ Release 页面下载 `4.2.6` 或 `4.1.11`。Docker 用户拉取镜像后，应按照原有部署配置重新创建容器。

## 临时缓解措施

以下仅保留补充文档中已经发送真实测试请求并取得明确 HTTP 响应的临时缓解措施。临时缓解不能替代升级。

### 使用 Nginx 过滤 UNC 路径特征

在 RabbitMQ Management UI 前部署 Nginx 反向代理，过滤包含编码反斜杠和原始反斜杠的 URL：

```nginx
server {
    listen 443 ssl;
    server_name rabbitmq-admin.example.com;

    # 拦截 %5C 编码，~* 表示大小写不敏感
    if ($request_uri ~* "%5[cC]") {
        return 403;
    }

    # 拦截原始反斜杠
    if ($request_uri ~ "\\\\") {
        return 403;
    }

    location / {
        proxy_pass http://127.0.0.1:15672;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

补充文档在 Kali Linux、Nginx `1.30.1` 和 Docker RabbitMQ `4.1.8` 环境中进行了真实请求验证：

| 测试 | Payload | HTTP 响应 | 结果 |
|---|---|---:|---|
| 基线请求 | `GET /` | `200` | Nginx 代理正常 |
| 标准攻击 | `GET /%5C%5C127.0.0.1%5Cshare` | `403` | 被拦截 |
| 大小写变体 | `GET /%5c%5c127.0.0.1%5cshare` | `403` | 被拦截 |
| 双编码变体 | `GET /%255C%255C127.0.0.1%255Cshare` | `404` | 绕过 `%5C` 过滤，但 Cowboy 单次解码后不足以触发漏洞 |
| 单 `%5C` | `GET /%5Ctest` | `403` | 被拦截 |

测试结果表明，Nginx `%5C` 过滤规则能够拦截标准攻击、大小写变体和单反斜杠编码。该方案生效的前提是攻击者无法绕过代理直接访问 RabbitMQ 的 `15672` 端口。

## 参考链接

1. [RabbitMQ 官方安全公告：漏洞影响、触发条件与修复版本](https://github.com/rabbitmq/rabbitmq-server/security/advisories/GHSA-7v84-m3g5-vxq6)
2. [RabbitMQ 主分支修复提交：增加路径片段校验](https://github.com/rabbitmq/rabbitmq-server/commit/39c3a8e9c71da0403d8dfc13f700e60c936e3682)
3. [RabbitMQ 维护分支修复提交：反向移植路径校验](https://github.com/rabbitmq/rabbitmq-server/commit/6730797f6a34b4e8308cea60adf1243857e70204)
4. [RabbitMQ 修复 PR #15803：修复方案与代码审查](https://github.com/rabbitmq/rabbitmq-server/pull/15803)
5. [RabbitMQ 4.2.6 Release：4.2.x 分支修复版本](https://github.com/rabbitmq/rabbitmq-server/releases/tag/v4.2.6)
6. [RabbitMQ v4.1.8 路由源码：`rabbit_mgmt_dispatcher.erl`](https://github.com/rabbitmq/rabbitmq-server/blob/v4.1.8/deps/rabbitmq_management/src/rabbit_mgmt_dispatcher.erl)
7. [RabbitMQ v4.1.8 静态文件处理源码：`rabbit_mgmt_wm_static.erl`](https://github.com/rabbitmq/rabbitmq-server/blob/v4.1.8/deps/rabbitmq_management/src/rabbit_mgmt_wm_static.erl)
8. [CVE.org：CVE-2026-57211 官方记录](https://www.cve.org/CVERecord?id=CVE-2026-57211)
9. [NVD：CVE-2026-57211 漏洞条目](https://nvd.nist.gov/vuln/detail/CVE-2026-57211)
