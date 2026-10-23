"""Build code-drawn Android tutorial diagrams; no real messages or pairing codes."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import math
OUT=Path(__file__).resolve().parents[1]/'public/guides/android-2026'
OUT.mkdir(parents=True,exist_ok=True)
W,H=480,820
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def font(n,b=False):return ImageFont.truetype(BOLD if b else FONT,n)
def txt(d,xy,t,size=18,color='#172421',bold=False):d.text(xy,t,font=font(size,bold),fill=color)
def lines(d,xy,items,size=17,color='#61716c',gap=27):
 for i,t in enumerate(items):txt(d,(xy[0],xy[1]+gap*i),t,size,color)
def base():
 im=Image.new('RGB',(W,H),'#edf0f3');d=ImageDraw.Draw(im)
 d.rounded_rectangle((10,5,470,807),radius=34,fill='white',outline='#cbd4d0',width=2)
 txt(d,(32,24),'9:00',15,bold=True);d.ellipse((232,24,246,38),fill='#172421');txt(d,(361,24),'▴  ▴  80%',13)
 d.rounded_rectangle((183,786,297,790),radius=2,fill='#35423d')
 return im,d
def chat(d):
 txt(d,(32,72),'WhatsApp',29,'#147b57',True);d.ellipse((376,77,391,92),outline='#172421',width=2);d.line((389,90,398,99),fill='#172421',width=2);txt(d,(430,72),'⋮',31)
 d.rounded_rectangle((28,126,452,173),radius=23,fill='#f2f4f3');txt(d,(49,139),'Preguntar a Meta AI o buscar',16,'#71817a')
 for x,t in [(32,'Todos'),(113,'No leídos'),(249,'Favoritos'),(368,'Grupos')]:
  d.rounded_rectangle((x,194,x+(68 if x==32 else 110 if x==113 else 104 if x==249 else 79),227),radius=16,fill='#e0f4e4' if x==32 else '#f3f5f4');txt(d,(x+9,202),t,13)
 for i in range(5):
  y=258+i*87;d.ellipse((30,y,86,y+56),fill='#cce8db');txt(d,(47,y+15),str(i+1),20,'#19815a',True);txt(d,(103,y+4),'Contacto '+str(i+1),19,bold=True);txt(d,(103,y+32),'Mensaje de ejemplo',15,'#708077');d.line((104,y+73,449,y+73),fill='#edf0ee')
 d.rectangle((23,718,457,776),fill='#f7faf8');txt(d,(43,737),'Chats',17,'#128c7e',True);txt(d,(150,737),'Novedades',14);txt(d,(282,737),'Comunidades',13);txt(d,(398,737),'Llamadas',11)
def page(step):
 im,d=base()
 if step in [1,2]:
  chat(d)
  if step==1:box=(415,63,457,115);arrow=(382,155,424,107)
  else:
   d.rounded_rectangle((181,62,458,376),radius=12,fill='white',outline='#d7dfdb',width=2)
   for i,t in enumerate(['Nuevo grupo','Nueva difusión','Dispositivos vinculados','Mensajes destacados','Ajustes']):txt(d,(199,83+i*57),t,16)
   box=(188,190,451,242);arrow=(129,220,184,220)
 elif step==3:
  txt(d,(29,77),'‹',30);txt(d,(68,82),'Dispositivos vinculados',23,bold=True)
  d.rounded_rectangle((152,173,328,288),radius=10,outline='#b3ccbf',width=4);d.line((124,306,356,306),fill='#b3ccbf',width=7)
  d.rounded_rectangle((211,218,269,323),radius=9,fill='#e3f4e9',outline='#7eac95',width=3)
  lines(d,(58,364),['Usa WhatsApp en otros dispositivos','vinculándolos a tu teléfono.'],18)
  d.rounded_rectangle((32,458,448,518),radius=28,fill='#128c7e');txt(d,(107,477),'Vincular un dispositivo',18,'white',True)
  txt(d,(34,566),'Tus dispositivos',18,bold=True);lines(d,(34,609),['Solo vincula dispositivos que','conozcas y autorices.'],17)
  box=(25,451,455,525);arrow=(241,402,241,447)
 elif step==4:
  txt(d,(29,77),'‹',30);txt(d,(68,82),'Escanear código QR',25,bold=True)
  lines(d,(43,148),['Para vincular un dispositivo,','puedes escanear su código QR.'],18)
  d.rounded_rectangle((73,253,407,588),radius=20,fill='#edf3f0',outline='#8bb8a2',width=3)
  # Empty scanner frame: intentionally no usable QR code.
  for x,y,sx,sy in [(92,273,1,1),(388,273,-1,1),(92,568,1,-1),(388,568,-1,-1)]:d.line([(x+sx*42,y),(x,y),(x,y+sy*42)],fill='#128c7e',width=6)
  txt(d,(117,650),'Vincular con el número',18,'#128c7e',True);txt(d,(178,676),'de teléfono',18,'#128c7e',True)
  box=(67,636,414,712);arrow=(239,576,239,632)
 else:
  txt(d,(29,77),'‹',30);txt(d,(68,82),'Ingresa el código',25,bold=True)
  lines(d,(39,164),['Introduce aquí el código que aparece','en la página donde solicitaste','la vinculación.'],18)
  txt(d,(40,287),'Nunca ingreses un código no solicitado.',16,'#56685f',True)
  for i in range(8):
   x=31+i*52+(7 if i>=4 else 0);d.rounded_rectangle((x,382,x+43,443),radius=8,fill='#f2f5f3',outline='#128c7e' if i==0 else '#cfd9d3',width=2)
  lines(d,(41,507),['Revisa el dispositivo y confirma','solo si tú pediste la vinculación.','Después vuelve a esta página.'],18)
  box=(24,374,456,452);arrow=(240,316,240,370)
 txt(d,(38,750),'Ilustración orientativa · Android',13,'#7a8881') if step not in [1,2] else None
 return im,box,arrow
for step in range(1,6):
 baseim,box,arrow=page(step);frames=[]
 for n in range(12):
  im=baseim.copy();d=ImageDraw.Draw(im);pulse=(1-math.cos(n*math.tau/12))/2
  d.rectangle(box,outline=(220,int(18+40*pulse),int(25+30*pulse)),width=4+round(pulse*2))
  x,y,tx,ty=arrow;dx,dy=tx-x,ty-y;length=math.hypot(dx,dy);ux,uy=dx/length,dy/length;shift=7*pulse
  x+=ux*shift;y+=uy*shift;tx+=ux*shift;ty+=uy*shift
  d.line((x,y,tx,ty),fill='#df1525',width=8)
  d.polygon([(tx,ty),(tx-ux*18-uy*11,ty-uy*18+ux*11),(tx-ux*18+uy*11,ty-uy*18-ux*11)],fill='#df1525')
  frames.append(im.quantize(colors=96))
 frames[0].save(OUT/f'step-{step}.gif',save_all=True,append_images=frames[1:],duration=90,loop=0,optimize=True,disposal=1)
 print(step,(OUT/f'step-{step}.gif').stat().st_size)
