---
layout:     post
title:      AQS:CountDownLatch
subtitle:   浅析并发编程AQS之CountDownLatch
date:       2018-11-21
author:     lvDobby
header-img: img/home-bg.jpg
catalog:    true
tags:
    - java
    - Thread
---

### AQS is what
AQS:AbstractQueuedSynchronizer，为java.util.concurrent包下CountDownLatch/FutureTask/ReentrantLock/RenntrantReadWriteLock/Semaphore实现的基础。

AQS通过内部实现的FIFO同步等待队列来完成资源获取线程的等待工作
如果当前线程获取资源失败，AQS则会将当前线程以及等待状态等信息构造成一个Node结构的节点，并将其加入等待队列中，同时会阻塞当前线程
当其它获取到资源的线程释放持有的资源时，则会把等待队列节点中的线程唤醒，使其再次尝试获取对应资源

#### AQS图解

Node就是等待队列里的一个节点，具体结构如下：

同步队列的基本结构：

AbstractQueuedSynchronizer类中其它方法主要是用于插入节点、释放节点，插入节点：

#### AQS源码解析
```
  
static  final class Node {

       //声明共享模式下的等待节点
       static final Node SHARED = new Node();

       //声明独占模式下的等待节点
       static final Node EXCLUSIVE = null;

       //waitStatus的一常量值，表示线程已取消
       static final int CANCELLED =  1;

       //waitStatus的一常量值，表示后继线程需要取消挂起
       static final int SIGNAL    = -1;

       //waitStatus的一常量值，表示线程正在等待条件
       static final int CONDITION = -2;

       //waitStatus的一常量值，表示下一个acquireShared应无条件传播
       static final int PROPAGATE = -3;

       //waitStatus,其值只能为CANCELLED、SIGNAL、CONDITION、PROPAGATE或0
       //初始值为0
       volatile int waitStatus;

       //前驱节点
       volatile Node prev;

       //后继节点
       volatile Node next;

       //当前节点的线程，在节点初始化时赋值，使用后为null
       volatile Thread thread;

       //下一个等待节点
       Node nextWaiter;

       Node() {
       }

       Node(Thread thread, Node mode) {    
           // Used by addWaiter
           this.nextWaiter = mode;
           this.thread = thread;
       }

       Node(Thread thread, int waitStatus) {
           // Used by Condition
           this.waitStatus = waitStatus;
           this.thread = thread;
       }
   }
```

#### AQS小结
AbstractQueuedSynchronizer实现了对资源获取与释放的基础实现，真正使用到的地方还在是各个具体的功能类中
如CountDownLatch、ReentrantLock等。


### CountDownLatch is what
CountDownLatch允许一个或者多个线程一直等待，直到一组其它操作执行完成。在使用CountDownLatch时，需要指定一个整数值，此值是线程将要等待的操作数。
当某个线程为了要执行这些操作而等待时，需要调用await方法。await方法让线程进入休眠状态直到所有等待的操作完成为止。
当等待的某个操作执行完成，它使用countDown方法来减少CountDownLatch类的内部计数器。
当内部计数器递减为0时，CountDownLatch会唤醒所有调用await方法而休眠的线程。

## CountDownLatch Demo
```
public class CountDownLatchDemo {
    public static void main(String[] args) {
        Timer timer = new Timer(5);
        new Thread(timer).start();
        for (int athleteNo = 0; athleteNo < 5; athleteNo++) {
            new Thread(new Athlete(timer, "athlete" + athleteNo)).start();
        }
    }
}

class Timer implements Runnable {
    CountDownLatch timerController;
    public Timer(int numOfAthlete) {
        this.timerController = new CountDownLatch(numOfAthlete);
    }

    public void recordResult(String athleteName) {
        System.out.println(athleteName + " has arrived");
        timerController.countDown();
        System.out.println("There are " + timerController.getCount() + " athletes did not reach the end");
    }

    @Override
    public void run() {
        try {
            System.out.println("Start...");
            timerController.await();
            System.out.println("All the athletes have arrived");
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}

class Athlete implements Runnable {
    Timer timer;
    String athleteName;

    public Athlete(Timer timer, String athleteName) {
        this.timer = timer;
        this.athleteName = athleteName;
    }

    @Override
    public void run() {
        try {
            System.out.println(athleteName + " start running");
            long duration = (long) (Math.random() * 10);
            Thread.sleep(duration * 1000);
            timer.recordResult(athleteName);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}
```
控制台输出：

```
Start...
athlete0 start running
athlete1 start running
athlete2 start running
athlete3 start running
athlete4 start running
athlete0 has arrived
There are 4 athletes did not reach the end
athlete3 has arrived
There are 3 athletes did not reach the end
athlete2 has arrived
athlete1 has arrived
There are 1 athletes did not reach the end
There are 2 athletes did not reach the end
athlete4 has arrived
There are 0 athletes did not reach the end
All the athletes have arrived
```
方法解析

1.构造方法 CountDownLatch(int count)构造一个指定计数的CountDownLatch，count为线程将要等待的操作数。

2.await() 调用await方法后，使当前线程在内部计数器倒计数至零之前一直等待，进入休眠状态，除非线程被中断。如果当前计数递减为零，则此方法立即返回，继续执行。

3.await(long timeout, TimeUnit unit) TimeUnit指定等待时间

3.acountDown() acountDown方法递减的计数，如果计数到零，则释放所有等待的线程。如果当前计数大于零，则将计数减少。

4.getCount() 调用此方法后，返回当前计数，即还未完成的操作数。

#### CountDownLatch源码
##### await()
```
public void await() throws InterruptedException {
        sync.acquireSharedInterruptibly(1);
    }

    public final void acquireSharedInterruptibly(int arg)
            throws InterruptedException {
        //如果当前线程中断，则抛出InterruptedException
        if (Thread.interrupted())
            throw new InterruptedException();        

        //尝试获取共享锁，如果可以获取到锁直接返回；
        //如果获取不到锁，执行doAcquireSharedInterruptibly
        if (tryAcquireShared(arg) < 0)
            doAcquireSharedInterruptibly(arg);
    }

    //如果当前内部计数器等于零返回1，否则返回-1；
    //内部计数器等于零表示可以获取共享锁，否则不可以；
    protected int tryAcquireShared(int acquires) {
        return (getState() == 0) ? 1 : -1;
    }

    //返回内部计数器当前值
    protected final int getState() {
        return state;
    }

    //该方法使当前线程一直等待，直到当前线程获取到共享锁或被中断才返回
    private void doAcquireSharedInterruptibly(int arg)
        throws InterruptedException {
        //根据当前线程创建一个共享模式的Node节点
        //并把这个节点添加到等待队列的尾部
        final Node node = addWaiter(Node.SHARED);
        boolean failed = true;
        try {
            for (;;) {
                //获取新建节点的前驱节点
                final Node p = node.predecessor();
                //如果前驱节点是头结点
                if (p == head) {
                    //尝试获取共享锁
                    int r = tryAcquireShared(arg);
                    //获取到共享锁
                    if (r >= 0) {
                        //将前驱节点从等待队列中释放
                        //同时使用LockSupport.unpark方法唤醒前驱节点的后继节点中的线程
                        setHeadAndPropagate(node, r);
                        p.next = null; // help GC
                        failed = false;
                        return;
                    }
                }

                //当前节点的前驱节点不是头结点，或不可以获取到锁
                //shouldParkAfterFailedAcquire方法检查当前节点在获取锁失败后是否要被阻塞
                //如果shouldParkAfterFailedAcquire方法执行结果是当前节点线程需要被阻塞
                  则执行parkAndCheckInterrupt方法阻塞当前线程
                if (shouldParkAfterFailedAcquire(p, node) &&
                    parkAndCheckInterrupt())
                    throw new InterruptedException();
            }
        } finally {
            if (failed)
                cancelAcquire(node);
        }
    }

    private Node addWaiter(Node mode) {
        //根据当前线程创建一个共享模式的Node节点
        Node node = new Node(Thread.currentThread(), mode);
        // Try the fast path of enq; backup to full enq on failure
        Node pred = tail;
        //如果尾节点不为空(等待队列不为空)，则新节点的前驱节点指向这个尾节点
        //同时尾节点指向新节点
        if (pred != null) {
            node.prev = pred;
            if (compareAndSetTail(pred, node)) {
                pred.next = node;
                return node;
            }
        }

        //如果尾节点为空(等待队列是空的)
        //执行enq方法将节点插入到等待队列尾部
        enq(node);
        return node;
    }

    Node(Thread thread, Node mode) { // Used by addWaiter
        this.nextWaiter = mode;
        this.thread = thread;
    }

    private Node enq(final Node node) {
        //使用循环插入尾节点，确保成功插入
        for (;;) {
            Node t = tail;
            //尾节点为空(等待队列是空的)
            //新建节点并设置为头结点
            if (t == null) { // Must initialize
                if (compareAndSetHead(new Node()))
                    tail = head;
            } else {
                //否则，将节点插入到等待队列尾部
                node.prev = t;
                if (compareAndSetTail(t, node)) {
                    t.next = node;
                    return t;
                }
            }
        }
    }

    //获取当前节点的前驱节点
    final Node predecessor() throws NullPointerException {
        Node p = prev;
        if (p == null)
            throw new NullPointerException();
        else
            return p;
    }

    //判断当前节点里的线程是否需要被阻塞
    private static boolean shouldParkAfterFailedAcquire(Node pred, Node node) {
        //前驱节点线程的状态
        int ws = pred.waitStatus;
        //如果前驱节点线程的状态是SIGNAL，返回true，需要阻塞线程
        if (ws == Node.SIGNAL)
            return true;
        //如果前驱节点线程的状态是CANCELLED，则设置当前节点的前去节点为"原前驱节点的前驱节点"
        //因为当前节点的前驱节点线程已经被取消了
        if (ws > 0) {
            do {
                node.prev = pred = pred.prev;
            } while (pred.waitStatus > 0);
            pred.next = node;
        } else {
            //其它状态的都设置前驱节点为SIGNAL状态
            compareAndSetWaitStatus(pred, ws, Node.SIGNAL);
        }
        return false;
    }

    //通过使用LockSupport.park阻塞当前线程
    //同时返回当前线程是否中断
    private final boolean parkAndCheckInterrupt() {
        LockSupport.park(this);
        return Thread.interrupted();
    }
```
##### countDown()

```
 public void countDown() {
        sync.releaseShared(1);
    }

    public final boolean releaseShared(int arg) {
        //如果内部计数器状态值递减后等于零
        if (tryReleaseShared(arg)) {
            //唤醒等待队列节点中的线程
            doReleaseShared();
            return true;
        }
        return false;
    }

    //尝试释放共享锁，即将内部计数器值减一
    protected boolean tryReleaseShared(int releases) {
        for (;;) {
            //获取内部计数器状态值
            int c = getState();
            if (c == 0)
                return false;
            //计数器减一
            int nextc = c-1;
            //使用CAS修改state值
            if (compareAndSetState(c, nextc))
                return nextc == 0;
        }
    }

    private void doReleaseShared() {
        for (;;) {
            //从头结点开始
            Node h = head;
            //头结点不为空，并且不是尾节点
            if (h != null && h != tail) {
                int ws = h.waitStatus;
                if (ws == Node.SIGNAL) {
                    if (!compareAndSetWaitStatus(h, Node.SIGNAL, 0))
                        continue;
                    //唤醒阻塞的线程
                    unparkSuccessor(h);
                }
                else if (ws == 0 &&
                        !compareAndSetWaitStatus(h, 0, Node.PROPAGATE))
                    continue;
            }
            if (h == head)
                break;
        }
    }

    private void unparkSuccessor(Node node) {
        int ws = node.waitStatus;
        if (ws < 0)
            compareAndSetWaitStatus(node, ws, 0);
        Node s = node.next;
        if (s == null || s.waitStatus > 0) {
            s = null;
            for (Node t = tail; t != null && t != node; t = t.prev)
                if (t.waitStatus <= 0)
                    s = t;
        }
        if (s != null)
            //通过使用LockSupport.unpark唤醒线程
            LockSupport.unpark(s.thread);
    }
```



