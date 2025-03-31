Hang on, gotta get everything organized before I post it! 😜

# kalilinuxmcp

kali linux mcp,pentest,penetration test

# 如何安装:

# 1: 首先要用ssh-keygen -t rsa做一个私钥和公钥,替换公钥到Dockerfile的

`'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCsoJo7WJIHDQgmEdKwm6IqS61xaGWa/OVVMCrMwcVh13xvYbAD7wdMufzNhWRxSso3SKvTHbQjIszvYQgkVFjRPiJW5vGCU0847CX0zZytGLnKpKWDZ5ccShMPlIxVuy2+WUQlKNL7f+w59PMX+3BLcikhtwk0xwG7tpS4kAtXHlrwt1B1vFj3CoF8rBofGJAahOuPvruRh9i1i73i5JJHJFeDdJVfNnY5/8HnBvtWtJzbsbmlyaTODfrDCeYZ32zxDZdsPVEls3RDsfgUadyC71mpXloJ8JTiUU37H5DY+xtIuz3XICwA7DsVm9jiKaSR96DZyogYxx+UKdrDsIH4JQwBNs3RDCX+t7ivKj75KkhhrW2X2h90EOjwQPQOhuVU2FtMXbWlfbZL5UwXGgA7Efe3N0ZzrKac+RGM6vY/jsnESgZaTayF/N/BysMpjI18xy6Y12CyPXVYsvF3v04d2XR1Fs5rduERjpot7o9N+i5FcoTfUb5WP5nVU9X0b2s= hack004@DESKTOP-H4HRI73'`

# 2:因为是国内环境,docker里我加了使用主机的socks5代理,自行搜索来替换"192.168.31.110",还有dns服务器也强制用dns2socks转到了本地127.0.0.1使用socks5代理,可自行去Dockerfile里替换或者去掉

# 3:原始使用的"booyaabes/kali-linux-full"镜像,但是里面软件版本有点老,自行选择是否要执行以下操作更新(主要需要更新很久!)

```1:进入docker容器后执行:
1:wget -q -O - https://archive.kali.org/archive-key.asc | gpg --import 
2:curl -fsSL https://archive.kali.org/archive-key.asc | sudo gpg --dearmor -o /usr/share/keyrings/kali-archive-keyring.gpg 
3:sudo apt update && sudo apt full-upgrade -y 
4:(下载更新最新版kali linux的所有工具,注意很大很慢)sudo apt install kali-linux-everything -y 
5:如果只需更新单独的软件,就无需执行4因为要很久,例如sudo apt install wpscan 
6:我自己倒是完成了最新更新,但是容器太大了几十G就不传了,需要的自行操作就行了```
```

# 4:(编译MCP),先npm install后直接npm run build,得到build目录,核心是index.js

# 5:(编译Docker镜像),

1:编译镜像:"docker build -t kali-pentest-mcp ."
2:部署镜像:"docker run --name kali-container -d --privileged -p 2222:22 kali-pentest-mcp"

# 6:安装MCP:

```
"kali-pentest-mcp-server": {
  "command": "node",
  "args": ["D:/kalimcp/build/index.js"],
  "env": {}
}
```

# 注意事项:

1: 每次重启docker后记得刷新MCP,因为可能SSH连接会断开

# 参考项目:

> https://github.com/weidwonder/terminal-mcp-server

# Lab: Blind SQL injection with out-of-band data exfiltration

![image](https://github.com/user-attachments/assets/a16a30f4-e699-4c89-ae2f-f8cc8dda4905)

![image](https://github.com/user-attachments/assets/172499c2-7392-4302-8396-bce8e73f43e3)

![image](https://github.com/user-attachments/assets/0c2faf26-e7e7-4788-a882-4d8c36f3f80b)

![image](https://github.com/user-attachments/assets/7cc362dc-c94c-499c-a272-1130ccf35b1b)

# command injection:

![image](https://github.com/user-attachments/assets/f1e75047-5c83-4206-95a4-28ce9fe82427)

![image](https://github.com/user-attachments/assets/76aaee67-2af0-4167-97bb-946ebf36e0aa)

![image](https://github.com/user-attachments/assets/2bfd3929-1d80-4dd5-94c8-26ed00f4fbce)

![image](https://github.com/user-attachments/assets/221acee6-297e-481b-813c-077bcc2df25b)

# Lab: Web shell upload via Content-Type restriction bypass

![image](https://github.com/user-attachments/assets/fcf30b5b-48b2-4cf9-a56a-e81277134942)

![image](https://github.com/user-attachments/assets/c6c6a60a-18a0-4087-b869-1d08f37b6ea8)

![image](https://github.com/user-attachments/assets/7fdd4c2b-30fd-4a5b-b473-e76617036be4)

![image](https://github.com/user-attachments/assets/fa3d0ccc-7000-481a-92a9-f1a6f2370bc1)

![image](https://github.com/user-attachments/assets/5d7c2678-a168-43f6-943a-8fb978d3f2c8)


