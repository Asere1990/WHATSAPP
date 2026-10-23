# Cubamax: slider de portada

El slider de portada es independiente del carrusel inferior existente. No modifica formularios, permisos, botones ni sesiones de WhatsApp.

- Texto inicial: campos `headline` y `accent` del editor de Cubamax, 6 segundos.
- Fotos siguientes: 5 segundos cada una, movimiento hacia la izquierda; gestos y flechas del teclado permiten navegar manualmente.
- Con movimiento reducido no avanza automáticamente. Con la página oculta suspende el temporizador. Las imágenes que no cargan se omiten.
- Formato uniforme de las fotos: **1200 × 800, 3:2**, WebP. `object-fit: contain` conserva la imagen completa.
- Archivos finales: `public/cubamax-promos/{remesas,ecoflow,bicicleta,contacto,carga,moto,equipo}.webp`.
- Secuencia y textos alternativos: `public/cubamax-headline.js`. La ruta de imágenes tiene una lista explícita en `src/main.js`.
- El editor de imágenes del slider inferior en Telegram sigue controlando únicamente ese carrusel inferior.

## Especificación de edición de las imágenes

Se utilizó la herramienta integrada de edición de imágenes con una llamada por original. Instrucción común: adaptar el anuncio a un formato horizontal 3:2, rectángulo completo sin márgenes exteriores; paleta verde turquesa `#319798`, naranja `#ed7b19` y blanco suave `#f7f9f8`, degradados y dibujos discretos de viajes y paquetes; conservar los productos, personas, marcas, textos y precios originales, sin inventar ofertas ni botones. Ajustar composición y espacios para legibilidad.

| Archivo original | Resultado | Instrucción específica |
| --- | --- | --- |
| IMG_4485.jpeg | remesas.webp | Conservar local y billete. REMESAS A CUBA / DESDE ESTADOS UNIDOS. |
| IMG_4484.jpeg | ecoflow.webp | EcoFlow portátil Delta 3, precio original $719. |
| IMG_4483.jpeg | bicicleta.webp | Bicicleta eléctrica Izuki The One; colores morado, negro y verde; conservar llamada a adquirirla. |
| IMG_4480.jpeg | contacto.webp | Adaptar foto vertical sin estirar y sustituir completamente (305) 512-0303 por **(786) 887-6115**. Conservar la persona, moto y cartel. |
| IMG_4481.jpeg | carga.webp | Carga aérea directa a la Isla de la Juventud, desde $4.99 la libra. |
| IMG_4482.jpeg | moto.webp | Conservar promoción original de envío de moto de gasolina y TV Homepoint de 32 pulgadas. |
| IMG_4479.jpeg | equipo.webp | Conservar las cuatro personas y logo; marco coordinado sin añadir frases. |

Los originales del usuario se conservaron sin sobrescribir. La conversión final a WebP normaliza las medidas y optimiza el peso.
