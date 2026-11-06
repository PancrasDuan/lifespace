# Issue #130：外部 Agent 认证方式研究

研究日期：2026-11-05。此文记录公开规范与待讨论的取舍，不代表已确认的产品需求或最终架构。

## 凭据是否只能使用一次

- OAuth 授权码是在授权流程中兑换令牌用的短期代码，只能使用一次；它不是每次记账都要让用户输入的密码。[RFC 6749 §4.1.2](https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2)
- 访问令牌在有效期及授权范围内可用于访问受保护资源，并非标准规定的单次使用。授权服务器可附带过期时间；资源服务应验证令牌未过期且权限覆盖请求。[RFC 6749 §5.1、§7](https://datatracker.ietf.org/doc/html/rfc6749#section-5.1)
- 刷新令牌是可选的，用于向授权服务器获取新的访问令牌，不发送给资源服务。具体实现可能在每次刷新时轮换刷新令牌并使旧值失效；这不意味着用户每次都需重新登录。[RFC 6749 §1.5、§6](https://datatracker.ietf.org/doc/html/rfc6749#section-1.5)；[RFC 9700 §4.14](https://datatracker.ietf.org/doc/html/rfc9700#section-4.14)
- OAuth 定义了撤销端点，但撤销效果与实现有关：如果服务不支持撤销访问令牌，撤销刷新令牌后，已签发的访问令牌不一定立即失效。[RFC 7009 §2、§5](https://datatracker.ietf.org/doc/html/rfc7009#section-2)

## MCP 与认证

- MCP 规范的授权是可选的；选择为 HTTP 传输提供授权时，规范建议遵循其 OAuth 授权流程。STDIO 传输的凭据处理不同，规范建议从环境获取凭据。[MCP 2026-07-28 授权规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- 在该 HTTP 流程中，MCP 服务是受保护资源服务，客户端代表资源所有者访问，授权服务器负责与用户交互及签发令牌。服务使用元数据让客户端发现授权服务器；受保护请求带访问令牌，服务需要检查该令牌是为其资源签发的。[MCP 授权规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- OAuth 授权可限定范围。MCP 规范建议客户端只申请所需权限，服务可在权限不足时提示所需范围；令牌授权的是客户端可做的操作，不等于证明用户已在外部 Agent 对话里确认了某一次记账。[MCP 授权规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)；[RFC 6749 §3.3](https://datatracker.ietf.org/doc/html/rfc6749#section-3.3)
- Bearer 令牌的持有者即可使用该令牌，因此令牌的安全存储和传输很重要。[RFC 6750 §1.2、§5](https://datatracker.ietf.org/doc/html/rfc6750#section-1.2)

## 可讨论的方案，尚未决定

1. **专用 API 凭据**：用户创建、复制并配置到 Agent；在失效或撤销前可多次使用。交互和实现可能较简单，但必须设计按用户归属、权限、撤销、过期及泄露后的处理；是否可供具体 Agent 安全配置须逐一验证。
2. **OAuth 授权连接**：用户在授权页面登录并同意 Agent 的权限；Agent 获得访问令牌，能否自动续期取决于授权服务器和客户端。可能减少手工复制凭据，并提供标准化授权交互，但需要处理服务发现、客户端兼容性、授权与撤销等实现。

两种方案都需要限制授权范围、执行账户隔离、处理撤销，且不自动保证 Agent 遵守对话中的每次写入确认。若选择 HTTP MCP，OAuth 流程的规范兼容性和目标客户端的实际支持应分别验证；MCP 本身也不是全部 Agent 都能接入的保证。

现有 LifeSpace 业务接口每次在线核验登录身份与白名单，Worker 注入账单所有者；是否复用现有认证能力、扩展认证服务器或增加另一种凭据，尚需结合方案核实。项目既有约束见 [认证 ADR](adr/0001-supabase-auth.md) 和 [账单 API 契约](ledger/api.md)。
