---
layout:     post
title:      浅析ThreadLocal
subtitle:   浅析ThreadLocal
date:       2018-11-12
author:     lvDobby
header-img: img/post-bg-rwd.jpg
catalog:    true
tags:
    - java
    - Thread
---

> 浅析ThreadLocal

### 先总述，后分析
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
#### Thread源码如下：
![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/thread.png)

#### ThreadLocal源码如下:
![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/threadlocal.png)

### ThreadLocal类提供如下几个核心方法：
#### createMap()
创建新的ThreadLocalMap,并将当前thread作为key,将实际值作为value,源码如下：
![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/createmap.png)

![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/threadloaclmap.png)
```
注：和HashMap的最大的不同在于，ThreadLocalMap结构非常简单，没有next引用，也就是说ThreadLocalMap中解决Hash冲突的方式并非链表的方式，而是采用线性探测的方式，所谓线性探测，就是根据初始key的hashcode值确定元素在table数组中的位置，如果发现这个位置上已经有其他key值的元素被占用，则利用固定的算法寻找一定步长的下个位置，依次判断，直至找到能够存放的位置。
ThreadLocalMap解决Hash冲突的方式就是简单的步长加1或减1，寻找下一个相邻的位置。
```
#### set()
用于保存当前线程的副本变量值,先获取当前线程对象，并判断ThreadLocalMap中是否含有以此线程为key的map，有则覆盖，无则创建。源码如下：

![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/set.png)

![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/threadlocalset.jpeg)
#### get()
用于获取当前线程的副本变量值，先获取当前线程对象，并判断ThreadLocalMap中是否含有以此线程为key的map，有则返回，无则初始化创建。源码如下：
![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/get.png)

![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/setinitalvalue.png)
```
注：上面的 initialValue()方法为protected，如果希望线程局部变量具有非null的初始值，则必须对ThreadLocal进行子类化，并重写此方法。
```
#### remove()
移除当前前程的副本变量值。拿到当前线程的threadLocals属性，如果不为空，则将key为当前ThreadLocal的键值对移除，并且会调用expungeStaleEntry方法清除key为空的Entry。源码如下：
![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/remove.png)

![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/threadlocalmapremove.png)
#### expungeStaleEntries()与expungeStaleEntry()
expungeStaleEntries方法（该方法和expungeStaleEntry类似，只是把搜索范围扩大到整个表）清理key为空的Entry
如果清理后size超过阈值的3/4，则进行扩容。
新表长度为老表2倍，创建新表。
遍历老表所有元素，如果key为null，将value清空；否则通过hash code计算新表的索引位置h，如果h已经有元素，则调用nextIndex方法直到寻找到空位置，将元素放在新表的对应位置。
设置新表扩容的阈值、更新size、table指向新表。源码如下：

![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/expungeStaleEntries.jpeg)

![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/expungeStaleEntry.jpeg)
#### getEntryAfterMiss()
从元素e开始向后遍历，如果找到目标Entry元素直接返回；如果遇到key为null的元素，调用expungeStaleEntry方法进行清除；否则，遍历到Entry为null时，结束遍历，返回null。源码如下：
![](https://github.com/LvDobby/LvDobby.github.io/blob/master/img/ThreadLocal/getentryaftermiss.png)

### 如何做到线程隔离
秘密就就在于上述叙述的ThreadLocalMap这个类。ThreadLocalMap是ThreadLocal类的一个静态内部类，它实现了键值对的设置和获取（对比Map对象来理解），每个线程中都有一个独立的ThreadLocalMap副本，它所存储的值，只能被当前线程读取和修改。ThreadLocal类通过操作每一个线程特有的ThreadLocalMap副本，从而实现了变量访问在不同线程中的隔离。

### 内存泄露问题
由于ThreadLocalMap的key是弱引用，而Value是强引用。这就导致了一个问题，ThreadLocal在没有外部对象强引用时，发生GC时弱引用Key会被回收，而Value不会回收，如果创建ThreadLocal的线程一直持续运行，那么这个Entry对象中的value就有可能一直得不到回收，发生内存泄露。

![](https://pic3.zhimg.com/v2-e57c1f07829acb9f53b0c650d78e566a_r.jpg)

如何避免泄漏
既然Key是弱引用，那么我们要做的事，就是在调用ThreadLocal的get()、set()方法时完成后再调用remove方法，将Entry节点和Map的引用关系移除，这样整个Entry对象在GC Roots分析后就变成不可达了，下次GC的时候就可以被回收。
如果使用ThreadLocal的set方法之后，没有显示的调用remove方法，就有可能发生内存泄露



