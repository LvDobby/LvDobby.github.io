---
layout:     post
title:      浅析ThreadLocal
subtitle:   浅析ThreadLocal
date:       2018-11-12
author:     lvDobby
header-img: img/post-bg-re-vs-ng2.jpg
catalog:    true
tags:
    - java
    - Thread
---

> 正所谓前人栽树，后人乘凉。
> 浅析ThreadLocal

# 先总述，后分析
Synchronized用于线程间的数据共享，而ThreadLocal则用于线程间的数据隔离。

### ThreadLocal是什么
ThreadLocal是一个关于创建线程局部变量的类。

通常情况下，我们创建的变量是可以被任何一个线程访问并修改的。而使用ThreadLocal创建的变量只能被当前线程访问，其他线程则无法访问和修改。

下图为ThreadLocal的内部结构图：
![](https://timgsa.baidu.com/timg?image&quality=80&size=b9999_10000&sec=1542019650767&di=7f0c68b5a04cdc1ebd5476bd5fec5ee7&imgtype=0&src=http%3A%2F%2Fimage.bubuko.com%2Finfo%2F201810%2F20181030182602401788.png)

### ThreadLocal、ThreadLocal、Thread之间的关系
    ThreadLocal是Thread的属性
　　ThreadLocalMap是ThreadLocal内部类，由ThreadLocal创建，Thread有ThreadLocal.ThreadLocalMap类型的属性
    Entry为ThreadLocalMap的内部类，其中包含真正的"map"：key为当前的Thread，value为我们set进的真正值
Thread的源码如下：
