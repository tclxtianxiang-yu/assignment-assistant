# 部署说明

本文档说明如何手动部署Web3精英班作业助手到Cloudflare Workers。

## 前置准备

1. Cloudflare账号（免费套餐即可）
2. OpenAI API密钥

## 部署步骤

### 1. 创建Cloudflare资源

#### 1.1 创建R2存储桶

1. 登录Cloudflare Dashboard
2. 进入 R2 Object Storage
3. 创建新存储桶，名称为：`jingcheng-homeworks`
4. 在存储桶中创建 `assignments/` 文件夹
5. 上传PDF作业文件到 `assignments/` 目录

#### 1.2 创建Vectorize索引

由于免费套餐限制，需要通过API创建（或在Dashboard中手动创建）：

```bash
# 如果有wrangler访问权限
wrangler vectorize create homework-index --dimensions=1536 --metric=cosine
```

### 2. 构建项目

```bash
# 本地构建
cd assignment-assistant
npm install
npm run build
```

构建完成后，会在 `dist/` 目录生成 `worker.js` 文件。

### 3. 手动部署到Cloudflare Workers

#### 3.1 创建Worker

1. 登录Cloudflare Dashboard
2. 进入 Workers & Pages
3. 点击 "Create Worker"
4. 给Worker命名，例如：`web3-homework-assistant`

#### 3.2 上传代码

1. 在Worker编辑页面，选择 "Quick Edit"
2. 删除默认代码
3. 打开本地的 `dist/worker.js` 文件
4. 复制全部内容
5. 粘贴到Worker编辑器中
6. 点击 "Save and Deploy"

#### 3.3 配置绑定

在Worker设置页面配置以下绑定：

**R2 Bucket绑定：**
- Variable name: `R2_BUCKET`
- R2 bucket: `jingcheng-homeworks`

**Vectorize绑定：**
- Variable name: `VECTOR_INDEX`
- Vectorize index: `homework-index`

#### 3.4 配置环境变量

在Worker设置 > Environment Variables 中添加：

- Variable name: `OPENAI_API_KEY`
- Value: `sk-proj-GSpYQhjJvntoDQy83fBZ...`（你的OpenAI API密钥）

### 4. 验证部署

访问以下端点验证部署：

- `https://your-worker.workers.dev/health` - 健康检查
- `https://your-worker.workers.dev/app` - 前端界面
- `https://your-worker.workers.dev/` - API文档

### 5. 初始化数据

使用管理员端点导入PDF文件到向量数据库：

```bash
curl -X POST https://your-worker.workers.dev/api/reindex \\
  -H "Authorization: Bearer admin-secret-token"
```

**注意**：需要先在代码中修改admin token或从环境变量读取。

## 更新部署

当代码有更新时：

1. 在本地运行 `npm run build`
2. 打开Worker编辑页面
3. 复制新的 `dist/worker.js` 内容
4. 粘贴并保存

## 配置自定义域名（可选）

1. 在Worker设置中点击 "Triggers"
2. 添加自定义域名
3. 按照提示配置DNS记录

## 监控和日志

- Worker Dashboard中可查看实时日志
- 监控请求数、错误率、响应时间等指标
- 免费套餐每天有100,000次请求限额

## 故障排查

### Worker部署失败

- 检查代码大小是否超过限制（免费套餐1MB）
- 确保所有依赖都已打包到单个文件中

### R2绑定失败

- 确保R2存储桶名称正确
- 检查绑定的变量名是否为 `R2_BUCKET`

### Vectorize查询失败

- 确保索引已创建且维度正确（1536）
- 检查绑定的变量名是否为 `VECTOR_INDEX`

### OpenAI API错误

- 确认API密钥有效
- 检查账户余额
- 验证环境变量设置正确

## 成本估算

基于免费套餐：

- **Workers**: 100,000 请求/天（免费）
- **R2 Storage**: 10GB存储（免费）
- **Vectorize**: 具体限额见Cloudflare文档
- **OpenAI API**: 按使用量计费
  - Embedding: ~$0.0001/1K tokens
  - GPT-3.5-turbo: ~$0.002/1K tokens

## 安全建议

1. 更改默认的admin token
2. 添加速率限制
3. 启用Cloudflare WAF（Web应用防火墙）
4. 定期审计访问日志
5. 使用Cloudflare Access控制管理端点

## 技术支持

遇到问题请参考：

- [Cloudflare Workers文档](https://developers.cloudflare.com/workers/)
- [Cloudflare R2文档](https://developers.cloudflare.com/r2/)
- [Cloudflare Vectorize文档](https://developers.cloudflare.com/vectorize/)
