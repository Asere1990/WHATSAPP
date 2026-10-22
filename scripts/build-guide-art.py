from pathlib import Path
from html import escape
ids=['prepare','open','linked','number','approve']
for device in ['android','iphone']:
    for idx,step in enumerate(ids):
        labels=[['Tu número de WhatsApp','+ ··· ··· ····','Obtener código'],
                ['Chats', 'Menú ⋮' if device=='android' else 'Configuración', 'Dispositivos vinculados'],
                ['Dispositivos vinculados','Vincular un dispositivo','Tus dispositivos'],
                ['Vincular un dispositivo','Vincular con número','En lugar de escanear el QR'],
                ['Introduce el código','· · · ·  · · · ·','Confirma dentro de WhatsApp']][idx]
        highlight=[2,1,1,1,1][idx]
        title='EN ESTA PÁGINA' if idx==0 else 'EN WHATSAPP'
        rows=''
        for n,label in enumerate(labels):
            y=130+n*66
            bg='#d8f5e7' if n==highlight else '#f2f6f4'
            color='#075e54' if n==highlight else '#6c8278'
            rows+=f'<rect x="59" y="{y}" width="242" height="50" rx="10" fill="{bg}"/><text x="180" y="{y+30}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="{700 if n==highlight else 400}" fill="{color}">{escape(label)}</text>'
        target=155+highlight*66
        svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="360" height="380" viewBox="0 0 360 380" role="img" aria-label="Ilustración orientativa del paso {idx+1}">
<rect width="360" height="380" rx="20" fill="#eff6f2"/>
<rect x="41" y="17" width="278" height="344" rx="31" fill="white" stroke="#b6d5c5" stroke-width="2"/>
<rect x="136" y="28" width="88" height="7" rx="4" fill="#d4e5dc"/>
<text x="180" y="72" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" font-weight="700" letter-spacing="2" fill="#128c7e">{device.upper()} · PASO {idx+1}</text>
<text x="180" y="99" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#075e54">{title}</text>
{rows}
<circle cx="303" cy="{target}" r="13" fill="#128c7e" opacity=".9"><animate attributeName="r" values="11;16;11" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;.45;.9" dur="1.8s" repeatCount="indefinite"/></circle>
<path d="M307 {target-4} l-7 4 7 4" fill="none" stroke="white" stroke-width="2"/>
<text x="180" y="341" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#6c8278">Ilustración orientativa · puede variar</text>
</svg>'''
        Path(f'public/guides/{device}-{step}.svg').write_text(svg)
