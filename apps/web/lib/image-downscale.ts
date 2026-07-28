/**
 * Redução da foto ANTES do upload (roda no navegador, via canvas).
 *
 * Dois motivos: a foto do celular chega com 4000 px e 8 MB, e o modelo não usa
 * nada disso — só encarece a chamada e o tempo de espera; e o que sai do canvas
 * é JPEG re-codificado, o que descarta os metadados EXIF do original (GPS,
 * aparelho, data), que não têm por que acompanhar a foto de um paciente.
 */

/** Maior lado da imagem enviada ao modelo. */
export const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.85;

/**
 * Dimensões de destino preservando a proporção. Imagem já pequena passa
 * INTACTA (ampliar só inventaria pixel). Função pura — é o que os testes cobrem.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_DIMENSION,
): { width: number; height: number } {
  const maior = Math.max(width, height);
  if (maior <= max || maior === 0) return { width, height };
  const escala = max / maior;
  return {
    width: Math.max(1, Math.round(width * escala)),
    height: Math.max(1, Math.round(height * escala)),
  };
}

/**
 * Reduz a foto e devolve um JPEG. Qualquer falha (formato exótico, canvas
 * indisponível) devolve o arquivo ORIGINAL: o servidor ainda valida formato e
 * tamanho, então o pior caso é um upload maior — nunca um fluxo travado.
 */
export async function downscaleImage(file: File, max: number = MAX_DIMENSION): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
    if (width === bitmap.width && height === bitmap.height && file.type === 'image/jpeg') {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
