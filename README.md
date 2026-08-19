# Nexus Cobertura

PWA estática para controlar puntos de efectivo usando Google Sheets como fuente de datos.

## Qué hace

- No usa login, Supabase ni usuarios.
- Cada punto de efectivo es un Google Spreadsheet guardado localmente en el dispositivo.
- El usuario selecciona la hoja activa del documento.
- Detecta automáticamente bloques de moneda con la estructura `ENTRADA / SALIDA / DESCRIPCION / TOTAL`.
- Toma el último `TOTAL` como saldo actual.
- Calcula el promedio diario de salidas sobre una ventana configurable.
- Calcula batería, días de cobertura y cantidad necesaria para recargar.
- Permite varias monedas y usa un selector global de moneda.
- Es instalable como PWA y está preparado para GitHub Pages.

## Fórmulas

```text
promedio_diario = suma_salidas_ventana / dias_promedio
reserva_objetivo = promedio_diario * dias_cobertura
bateria = min(100, max(0, saldo_actual / reserva_objetivo * 100))
recarga = max(0, reserva_objetivo - saldo_actual)
dias_cobertura_actual = saldo_actual / promedio_diario
```

Si el promedio diario es 0, el nivel se considera 100% porque no existe consumo dentro del período.

## Requisito de Google Sheets

Como la app no tiene inicio de sesión ni OAuth, cada documento debe estar compartido como:

**Cualquier persona con el vínculo → Lector**

La app descarga el XLSX publicado por Google únicamente para lectura. No modifica el Spreadsheet.

## Estructura esperada

La app busca los encabezados `ENTRADA`, `SALIDA` y `TOTAL` en las primeras 20 filas. La fecha debe estar en una columna situada antes de `ENTRADA`; las filas con fecha vacía heredan la última fecha válida, igual que en los archivos de efectivo actuales.

Puede haber varios bloques de moneda en una misma hoja (por ejemplo CUP y USD).

## Publicación en GitHub Pages

El repositorio incluye `.github/workflows/pages.yml`. Después de subir el proyecto al repositorio, en GitHub:

1. Settings → Pages.
2. Source → GitHub Actions.
3. Haz push a `main`.

El workflow desplegará la aplicación automáticamente.
