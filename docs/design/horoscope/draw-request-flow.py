from xml.etree.ElementTree import Element, SubElement, ElementTree
from pathlib import Path

W,H=1760,1680
svg=Element('svg', {'xmlns':'http://www.w3.org/2000/svg','width':str(W),'height':str(H),'viewBox':f'0 0 {W} {H}','role':'img','aria-labelledby':'title desc'})
SubElement(svg,'title',{'id':'title'}).text='LifeSpace 星座运势当前请求流程与实测耗时'
SubElement(svg,'desc',{'id':'desc'}).text='浏览器内存未命中时，请求经本地 Wrangler 转发至 Cloudflare Worker，先读取 KV；有效当日缓存匿名返回，未命中才验证 Supabase 会话和白名单，之后调用 ALAPI，校验内容并等待 KV 写入后返回。红色标出实测主要等待阶段。'
def node(tag,attrs=None,parent=svg): return SubElement(parent,tag,{k:str(v) for k,v in (attrs or {}).items()})
def rect(x,y,w,h,fill='#ffffff',stroke='none',radius=14,parent=svg):
 return node('rect',{'x':x,'y':y,'width':w,'height':h,'rx':radius,'fill':fill,'stroke':stroke},parent)
def text(x,y,value,size=18,fill='#203b36',weight=400,anchor='start',parent=svg):
 t=node('text',{'x':x,'y':y,'font-size':size,'fill':fill,'font-weight':weight,'text-anchor':anchor},parent);t.text=value;return t

def label(x,y,value,color='#536b63',size=17,bg='#f7f8f4'):
 # 每个汉字按一个字号估算，避免文字与虚线生命线重叠。
 width=sum(size*(.57 if ord(c)<128 else 1) for c in value)+22
 rect(x-width/2,y-size+2,width,size+9,bg,radius=5)
 text(x,y,value,size,color,anchor='middle')

def arrow(x1,x2,y,value,color='#547168',dash=False,bg='#f7f8f4',size=17):
 attrs={'x1':x1,'x2':x2,'y1':y,'y2':y,'stroke':color,'stroke-width':2.3,'marker-end':f'url(#{"red" if color=="#b25335" else "green" if color=="#32785c" else "normal"})'}
 if dash: attrs['stroke-dasharray']='7 6'
 node('line',attrs)
 label((x1+x2)/2,y-11,value,color,size,bg)

def badge(x,y,value,fill='#e5eee7',color='#32785c',width=150):
 rect(x,y,width,31,fill,radius=8)
 text(x+width/2,y+21,value,16,color,600,'middle')

def actor(x,y,w,title,sub,fill='#ffffff',stroke='#d5ded6',tone='#203b36'):
 rect(x,y,w,78,fill,stroke,14)
 text(x+w/2,y+31,title,21,tone,600,'middle')
 text(x+w/2,y+57,sub,14,tone,400,'middle')

defs=node('defs')
for mid,color in [('normal','#547168'),('green','#32785c'),('red','#b25335')]:
 m=node('marker',{'id':mid,'viewBox':'0 0 10 10','refX':9,'refY':5,'markerWidth':7,'markerHeight':7,'orient':'auto-start-reverse'},defs)
 node('path',{'d':'M 0 0 L 10 5 L 0 10 z','fill':color},m)
node('style',parent=defs).text="text{font-family:'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif}"
rect(0,0,W,H,'#f7f8f4',radius=0)
rect(0,0,W,7,'#203f35',radius=0)
text(64,52,'LIFESPACE  /  REQUEST MAP  /  2026.10.22',14,'#6a7e70',600)
text(64,108,'星座运势：一次点击，哪些请求真的发生？',39,'#193d31',650)
text(64,146,'当前方案：当日有效 KV 缓存匿名可读；缓存未命中先鉴权，再按需回源。',19,'#607367')
rect(64,177,1632,100,'#eaf0e6','#d7e1d1')
badge(84,194,'先看浏览器内存','#d5e4ce','#345d38',174)
text(280,216,'当天、同星座且内存结果仍有效 → 直接展示，不发送业务请求。',20,'#294d3a',550)
text(86,250,'未命中内存才继续下图。SDK 取已有会话；正反面共享同一份数据，翻转和返回不请求接口。',18,'#536c55')
# 六个参与者的生命线。
actors=[(64,195,'浏览器','React Query / 当前会话'),(310,210,'本地 Wrangler','127.0.0.1:8788 转发'),(580,240,'Cloudflare Worker','正式 Hono 路由 / 业务编排'),(930,220,'Supabase Auth','仅运势缓存未命中鉴权'),(1210,190,'Cloudflare KV','共享当天完整运势'),(1465,230,'ALAPI','中文星座运势数据源')]
centers=[x+w/2 for x,w,_,_ in actors]
browser,proxy,worker,auth,kv,alapi=centers
rect(300,300,230,985,'#f3eee4',radius=14)
text(proxy,294,'仅当前预览多这一跳',14,'#96744f',550,'middle')
for x in centers:
 node('line',{'x1':x,'x2':x,'y1':388,'y2':1270,'stroke':'#d3ddd4','stroke-width':1.4,'stroke-dasharray':'4 7'})
for x,w,title,sub in actors:
 actor(x,308,w,title,sub,fill='#203f35' if title=='Cloudflare Worker' else '#ffffff',stroke='#203f35' if title=='Cloudflare Worker' else '#d5ded6',tone='#f3f7eb' if title=='Cloudflare Worker' else '#203b36')
arrow(browser,proxy,431,'GET /api/horoscope?sign=…',size=15)
arrow(proxy,worker,480,'携带会话 / 远程转发',size=16)
arrow(worker,kv,537,'KV.get（北京日期 + 星座）')
arrow(kv,worker,582,'校验结构、星座、日期与有效期',dash=True,size=16)
rect(79,621,1616,655,'none','#cbd7cb',14)
text(96,646,'两条互斥路径',14,'#6c8172',600)
badge(608,636,'① KV 有效命中','#dbeada','#2d6849',173)
arrow(worker,proxy,691,'直接返回 cacheHit=true',color='#32785c',size=16)
arrow(proxy,browser,731,'渲染卡片',color='#32785c',size=16)
text(933,692,'匿名可读，不请求 Auth 或 ALAPI，不写 KV。',18,'#32785c',550)
text(933,724,'实测命中：Worker 105 ms；非延迟保证。',17,'#63816c')
node('line',{'x1':96,'x2':1680,'y1':760,'y2':760,'stroke':'#cbd7cb','stroke-dasharray':'4 5'})
badge(608,776,'② KV 未命中 / 无效','#f5e2d0','#a25a2f',202)
arrow(worker,auth,831,'GET /auth/v1/user')
arrow(auth,worker,874,'有效会话 + 当前邮箱白名单',dash=True)
text(933,917,'匿名 401 / 非白名单 403；均不回源。',17,'#975034')
label(worker,922,'获准后才加入并发合并 / 节流',size=15)
arrow(worker,alapi,961,'POST /api/star · Token 仅在服务端 · 只消费 day',color='#b25335',size=18)
label((worker+alapi)/2,990,'首包等待探针：2,705–5,096 ms',color='#b25335',size=21,bg='#fbeee2')
arrow(alapi,worker,1034,'响应 → 检查 HTTP、业务状态、今日日期与字段',color='#b25335',dash=True,size=17)
arrow(worker,kv,1091,'await KV.put（有效期至北京次日零点）',size=17)
arrow(kv,worker,1135,'写入完成：220–246 ms',dash=True,size=17)
arrow(worker,proxy,1204,'返回当天完整 JSON',color='#32785c',size=16)
arrow(proxy,browser,1243,'渲染正面 / 翻转复用',color='#32785c',size=15)
# 边界规则保持简短，非主路径不加入交叉箭头。
rect(64,1300,800,116,'#ffffff','#d9e1d7')
text(86,1330,'日期与错误边界',18,'#274f3c',600)
text(86,1361,'距零点不足 60 秒跳过写入；写失败可返回本次合法内容。',17,'#586f62')
text(86,1389,'KV 读失败停止回源；昨日内容不冒充今日，不缓存错误。',17,'#586f62')
rect(884,1300,812,116,'#ffffff','#d9e1d7')
text(906,1330,'并发与重试边界',18,'#274f3c',600)
text(906,1361,'同实例并发有限等待；回源节流与失败退避，无后台预热。',17,'#586f62')
text(906,1389,'会话明确过期才续期重试一次；没有全局恰好一次保证。',17,'#586f62')
# 两个计时口径不混用。
rect(64,1440,1632,154,'#f8ede3','#e5c9b6')
text(86,1475,'定位网络 I/O：两种计时口径，不能直接当作同一段耗时',23,'#975034',600)
text(86,1510,'截图：ALAPI 日志多数 1–5 ms，是提供方记录的服务端耗时；不是 Worker 发起请求到收完响应的整段时间。',18,'#795c48')
text(86,1541,'探针：响应头等待 2.705–5.096 s，约 8.7 KB 正文未观察到额外等待；本机对照也出现 TLS 连接延迟。',18,'#795c48')
text(86,1572,'判断：网络 / 访问链路值得优先排查；当前尚不能进一步分离 DNS、TLS、路由、连接复用或其他处理开销。',18,'#795c48')
text(64,1635,'生产路径：浏览器 → 生产域名的 Cloudflare Worker → Auth / KV / ALAPI；没有本机 Wrangler 转发这一跳。',18,'#5c7364')
text(1696,1665,'源码：HoroscopeCard / authorizedFetch / Worker / readHoroscope  ·  非地理拓扑  ·  网站界面仍需登录',13,'#7d8e80',anchor='end')
out=Path(__file__).resolve().parent / 'request-flow.svg'
ElementTree(svg).write(out,encoding='utf-8',xml_declaration=True)
print(out)
