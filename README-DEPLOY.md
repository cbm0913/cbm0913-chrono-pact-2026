# 时之契 · 好友约战正式服务器部署

这个目录已经是一个可部署的 Node.js 服务：

- `server.js`：房间创建、加入、SSE 实时中继
- `pvp.html`：好友约战页面
- `index.html`：AI 模式
- `package.json`：`npm start` 启动
- `Dockerfile` / `render.yaml` / `railway.json`：平台部署配置

服务无第三方依赖，只需要 Node.js 18+。

---

## 一、本地运行

```bash
cd D:\游戏deepseek
npm start
```

打开：

```text
http://127.0.0.1:8787/pvp.html
```

局域网手机（同一 Wi-Fi）：

```text
http://电脑局域网IP:8787/pvp.html
```

注意必须带 `:8787`，并且 Windows 防火墙要允许 Node 或 8787 端口。

---

## 二、Render 免费部署（推荐先试）

需要你有一个 GitHub 账号和一个 Render 账号。

### 1. 上传到 GitHub

在 GitHub 新建一个空仓库，把本目录这些文件上传：

```text
server.js
pvp.html
index.html
package.json
render.yaml
railway.json
Dockerfile
```

不要上传 `_edgeprofile_*`、测试脚本、日志。

### 2. Render 创建 Web Service

1. 登录 https://render.com
2. 点 **New +** → **Web Service**
3. 连接你的 GitHub 仓库
4. 配置：
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: **Free**
5. 点 **Create Web Service**

也可以直接用仓库里的 `render.yaml` 走 Blueprint。

### 3. 部署完成后的地址

Render 会给你类似：

```text
https://chrono-pact-pvp.onrender.com
```

游戏地址：

```text
https://chrono-pact-pvp.onrender.com/pvp.html
```

健康检查：

```text
https://chrono-pact-pvp.onrender.com/api/health
```

### 4. 手机加入

电脑打开部署后的 `/pvp.html`，创建房间。  
页面生成的“手机加入链接”会自动使用部署域名，手机用流量也能打开。

---

## 三、Railway 部署

1. 登录 https://railway.app
2. **New Project** → **Deploy from GitHub repo**
3. 选择仓库
4. Railway 会读取 `railway.json`，执行 `npm start`
5. 在 **Settings → Networking → Generate Domain** 生成公网域名
6. 打开：

```text
https://你的域名/pvp.html
```

---

## 四、Docker / VPS 部署

适用于阿里云、腾讯云、华为云等有公网 IP 的服务器。

### 构建镜像

```bash
docker build -t chrono-pact .
```

### 运行

```bash
docker run -d \
  --name chrono-pact \
  -p 8787:8787 \
  -e PORT=8787 \
  --restart unless-stopped \
  chrono-pact
```

### 开放端口

云服务器安全组放行 TCP 8787。

### 访问

```text
http://服务器公网IP:8787/pvp.html
```

建议在前面加 Nginx + HTTPS 域名。

---

## 五、Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 必须关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
```

HTTPS 可以用 Certbot / 云厂商证书。

---

## 六、重要限制

- 房间数据存在内存里，服务重启后房间消失
- 免费平台休眠后，第一次访问会慢几秒
- 房主必须保持页面打开；房主离开，房间结束
- 当前仍是 1v1，双方共用房主卡组
- 没有账号系统，房间靠 6 位房间号 + token
- 公网部署后不要把管理接口暴露给不可信的人（本服务没有管理接口）

---

## 七、部署后检查

```text
/api/health
```

应返回：

```json
{"ok":true,"rooms":0}
```

再打开：

```text
/pvp.html
```

创建房间，确认生成的“手机加入链接”是这个部署域名，而不是 `127.0.0.1` 或 `192.168.x.x`。
