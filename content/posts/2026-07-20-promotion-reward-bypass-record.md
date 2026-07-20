---
title: "推广奖励场景中的账号生命周期绕过：通杀型漏洞挖掘记录"
date: 2026-07-20
publishedAt: 2026-07-20T11:10:39+08:00
category: 漏洞分析
slug: promotion-reward-bypass-record
coverText: 推广
summary: "整理账号生命周期与推广奖励绑定错位带来的重复领取问题，并记录一组横向验证结论。"
published: true
encrypted: true
passwordEnv: PROMO_REWARD_POST_PASSWORD
---

> **实验说明：** 本文仅记录授权测试环境中的漏洞复现与逆向分析过程。请求、账号与命令均为实验数据，请勿用于未授权目标；建议在隔离虚拟机中完成验证。

## 摘要

本文记录了一类在“注销 / 解绑 / 第三方登录 / 邀请奖励”组合场景中反复出现的推广奖励绕过问题。其核心并非单点接口缺陷，而是账号生命周期、登录因子与奖励状态之间的绑定关系设计存在缝隙：当平台把“新用户奖励”绑定到可复用的手机号、邮箱、OAuth 账号等登录因子，而没有把奖励状态稳定绑定到同一个自然人或长期主体时，用户就有机会通过解绑、注销、重新注册或换绑来重复触发推广收益。

下面按实际挖掘过程整理若干平台与项目中的账号生命周期绕过，以及某 API 项目的横向验证思路。

## 一、账号中心鉴权逻辑缺陷导致的推广奖励重置

### 1. 思路

核心逻辑可以概括为：当“账号注销 / 解绑能力”和“邀请推广奖励”同时存在，且两者之间缺少统一的状态约束时，推广奖励可能被重复触发。

![核心逻辑示意](/assets/posts/promotion-reward-bypass-record/20260720102937041.png)

某账号中心平台允许账号绑定多种找回与登录因子。为了避免用户同时解绑全部双因素导致账号丢失，邮箱在流程中通常采用“换绑”而不是直接解绑的设计。问题出现在手机号与邮箱、主账号与新账号之间的状态迁移：手机号从旧账号解绑后，可继续作为验证码登录因子触发新账号流程；随后旧账号又可以重新绑定该手机号，从而形成循环。

### 2. 复现过程

1. 在目标平台使用手机号 A 注册或绑定账号。下图为已注册账号的绑定状态示意。

   ![账号绑定状态](/assets/posts/promotion-reward-bypass-record/1766725262287-f72a487e-0d77-4607-bd0f-606f38025a51.png)

2. 使用手机号 A 登录 Quake，确认该手机号对应的账号已经领取过注册奖励。

   ![使用手机号登录 Quake](/assets/posts/promotion-reward-bypass-record/1767062658769-48b0fab3-74a1-482d-a3ec-46ab28b7fcee.png)

3. 回到目标平台，将手机号 A 从当前账号解绑。

   ![解绑手机号](/assets/posts/promotion-reward-bypass-record/1766725399222-f699aa85-e916-4a1f-9120-895ce3c7b45f.png)

4. 绑定邮箱 A 后，保留仅有邮箱 A 的原账号，后文称为“账号 1”。

5. 再次使用手机号 A 的验证码登录 Quake。此时平台会进入新的账号状态，可再次输入邀请码并领取奖励，后文称为“账号 2”。

   ![手机号验证码重新登录](/assets/posts/promotion-reward-bypass-record/1767062690248-97cdfe49-d4f8-4169-96d8-62ede4bbdf03.png)

   ![重新输入邀请码](/assets/posts/promotion-reward-bypass-record/1767062711464-f60c5378-0de8-4a56-a0d9-6b3fc67a6fe3.png)

6. 回到目标平台登录账号 1，将账号 2 当前使用的手机号 A 强制绑定回账号 1。

   ![重新绑定手机号](/assets/posts/promotion-reward-bypass-record/1766725327563-940084da-d457-421a-b395-1bc402ebecbc.png)

   ![绑定完成](/assets/posts/promotion-reward-bypass-record/1766725697508-c28058b7-7408-49a0-915f-dc2a19fc8959.png)

7. 完成上述操作后，手机号 A 又回到账号 1，流程可以从解绑手机号开始再次循环。

   ![循环结果示意](/assets/posts/promotion-reward-bypass-record/1766725333502-0a81b8ae-9b32-4947-9dc9-0ff3ee61c97c.png)

### 3. 风控限制与收益模型

平台侧存在一定风控策略：当天注册或绑定的手机号通常需要次日再进行关键操作。因此，一个手机号与一个邮箱的组合，在该策略下每天仍可能触发一次积分收益。

邀请奖励是双向的。例如 Quake 邀请码被填写后，邀请人与被邀请人都会增加积分；纳米相关场景中也存在双向奖励逻辑。整体上，可以将一个主账号作为收益账户，再通过另一个辅助账号执行绑定、解绑和重新注册流程。

### 4. 结果

最终奖励结果：300 元。

## 二、基于相同思路的横向拓展：移动应用推广奖励问题

### 1. 思路

某移动应用的问题与上一节类似：一个可登录途径就可以视为一个独立身份因子。如果平台把“新用户权益”绑定在这些可切换的登录因子上，而没有稳定合并到同一用户主体，就会产生重复领取空间。

![登录因子示意 1](/assets/posts/promotion-reward-bypass-record/5f05283fd75f559dcffe6e5c375d57db.jpg)

![登录因子示意 2](/assets/posts/promotion-reward-bypass-record/7f61e2cdb62b805688394ae54ccbd152.jpg)

从页面可以看到，当前场景中存在 7 个可用身份因子。

![身份因子列表](/assets/posts/promotion-reward-bypass-record/9c18912643f24a7bb8688c2b18b82279.jpg)

每个因子都可以领取 7 天权益，且手机号绑定不是强制流程。换句话说，平台把权益触发点放在了“登录因子首次进入”的状态上，而不是稳定主体的首次进入。

### 2. 结果

该问题暂时没有进一步跟进结果。

## 三、途径延伸类推广漏洞：相关产品通用场景

### 1. 思路

某相关产品上线测试阶段曾出现过更直接的推广奖励问题：A 账号注册并分享邀请链接，B 账号通过邀请链接注册后给 A 返现；随后 B 账号注销并重新注册，循环触发积分。该问题在测试阶段已有一定防护。

![推广规则示意](/assets/posts/promotion-reward-bypass-record/image-20260705104323601.png)

本次发现的绕过点位于 GitHub 账号体系：平台侧对账号注销后的再次注册做了限制，但 GitHub OAuth 账号可以重新创建并再次授权。虽然平台要求注册后绑定手机号，开发侧却没有对手机号重复绑定做有效校验，导致一个邮箱体系加一个手机号就可以持续绕过推广奖励限制。

### 2. 复现步骤

1. 准备 A 账号作为主收益账号。

   ![A 账号积分页面](/assets/posts/promotion-reward-bypass-record/image-20260705104624466.png)

2. B 账号通过 GitHub 注册，并进入平台获取邀请链路。

3. 访问 A 账号的邀请码链接，通过 Google 邮箱注册 GitHub 账号后完成授权。

   ![GitHub 注册流程 1](/assets/posts/promotion-reward-bypass-record/image-20260705105053592.png)

   ![GitHub 注册流程 2](/assets/posts/promotion-reward-bypass-record/image-20260705105123904.png)

   ![GitHub 注册流程 3](/assets/posts/promotion-reward-bypass-record/image-20260705105147300.png)

4. 示例中使用邮箱 A 完成 GitHub 注册。

   ![邮箱注册示意 1](/assets/posts/promotion-reward-bypass-record/image-20260705105203492.png)

   ![邮箱注册示意 2](/assets/posts/promotion-reward-bypass-record/image-20260705105215577.png)

5. 注册后绑定手机号 A。

   ![绑定手机号](/assets/posts/promotion-reward-bypass-record/image-20260705105240747.png)

6. 绑定完成后，A 账号积分增加 1000。

   ![积分增加](/assets/posts/promotion-reward-bypass-record/image-20260705105253386.png)

7. 注销 B 账号，同时注销对应 GitHub 账号。

   ![注销 B 账号](/assets/posts/promotion-reward-bypass-record/image-20260705105834182.png)

8. 回到平台，再次访问 A 账号邀请链接，并继续通过 GitHub OAuth 重新注册 B 账号。

   ![重新访问邀请链接](/assets/posts/promotion-reward-bypass-record/image-20260705105938237.png)

   ![重新注册流程](/assets/posts/promotion-reward-bypass-record/image-20260705105957165.png)

9. 直接授权后，平台再次要求绑定手机号。

   ![GitHub 授权](/assets/posts/promotion-reward-bypass-record/image-20260705110009864.png)

   ![再次绑定手机号](/assets/posts/promotion-reward-bypass-record/image-20260705110031504.png)

10. 继续使用手机号 A 完成绑定，并成功登录。

    ![绑定手机号 A](/assets/posts/promotion-reward-bypass-record/image-20260705110109757.png)

    ![成功登录](/assets/posts/promotion-reward-bypass-record/image-20260705110126500.png)

### 3. 结果

后续反馈该项目主要面向内部 SRC 场景，补偿了一定中转站积分。

## 四、基于同类思路的 API 项目验证记录

在某 API 项目场景中，也可以沿着“账号生命周期 + 邀请奖励 + 登录因子复用”的组合思路做验证。经过实际检查，该项目已对用户名和邮箱做了重复性校验，因此这里**未形成可稳定利用的 0day**。

这说明同类风险并不必然成立，关键仍然取决于平台是否把奖励状态稳定绑定到同一主体，以及是否对重复注册、重复绑定和注销后的重建身份保留足够的历史约束。

重点观察的状态边界包括：

- 用户注销后，邀请关系、奖励状态、手机号 / 邮箱 / 第三方登录绑定是否同步清理；
- 同一登录因子再次进入系统时，平台判断的是“首次注册”还是“历史主体”；
- 邀请奖励是否只校验当前账号状态，而缺少跨生命周期的唯一性约束；
- 多个登录因子绑定到同一主体时，奖励状态是否可以被拆分或重置。

![场景截图 1](/assets/posts/promotion-reward-bypass-record/20260720104616105.png)

![场景截图 2](/assets/posts/promotion-reward-bypass-record/20260720104610614.png)

## 五、通杀模式总结

这类推广漏洞的共性在于：平台把奖励触发条件绑定在“看起来像新用户”的可变因子上，而不是绑定在稳定且可追踪的用户主体上。常见触发组合包括：

1. **注销后再次注册**：账号生命周期被重置，奖励状态也随之重置。
2. **手机号 / 邮箱解绑后复用**：身份因子从旧主体脱离，再以新主体身份触发奖励。
3. **OAuth 第三方账号重建**：平台只信任第三方返回的新身份，而忽略本地侧历史绑定记录。
4. **多登录因子拆分**：手机号、邮箱、GitHub、微信、Apple ID 等因子被当作彼此独立的新用户入口。
5. **邀请奖励双向发放**：邀请人与被邀请人同时获益，放大了循环利用收益。

## 六、修复建议

1. **奖励状态绑定稳定主体**：将邀请奖励、首登权益、注册奖励等状态绑定到长期主体，而不是单个可解绑因子。
2. **保留关键因子的历史占用记录**：手机号、邮箱、OAuth openid / unionid 等关键因子进入过奖励流程后，应在奖励维度保留历史标记。
3. **注销与解绑不应重置奖励状态**：注销可以清理登录态和个人资料，但奖励状态、风控标签和邀请关系应单独保留。
4. **加强重复绑定校验**：同一手机号、邮箱或 OAuth 身份重复进入系统时，应关联历史主体并阻断重复奖励。
5. **邀请奖励增加冷却与风控维度**：结合设备、IP、手机号归属、支付渠道、邮箱域名、OAuth 账号创建时间等维度建立风控策略。
6. **统一处理跨产品账号体系**：对于多产品共用账号中心的场景，奖励状态应在账号中心或统一风控服务中沉淀，避免不同产品间状态割裂。
