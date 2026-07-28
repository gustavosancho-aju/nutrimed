import { describe, it, expect } from 'vitest';
import { fitWithin, MAX_DIMENSION } from './image-downscale';

describe('fitWithin — dimensões do downscale', () => {
  it('reduz pelo maior lado, preservando a proporção', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 768, height: 1024 });
    expect(fitWithin(2048, 2048)).toEqual({ width: 1024, height: 1024 });
  });

  it('deixa intacta a imagem que já cabe (nunca amplia)', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_DIMENSION, 500)).toEqual({ width: MAX_DIMENSION, height: 500 });
  });

  it('não zera o lado menor em fotos muito alongadas', () => {
    expect(fitWithin(6000, 12)).toEqual({ width: 1024, height: 2 });
    expect(fitWithin(9000, 3)).toEqual({ width: 1024, height: 1 });
  });

  it('aceita um teto diferente e tolera dimensão zero', () => {
    expect(fitWithin(4000, 2000, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
