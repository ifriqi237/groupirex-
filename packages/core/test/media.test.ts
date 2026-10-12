import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRODUCT_MEDIA_LIMITS, mediaProblem } from '../src/media';

const photos = (n: number) => Array.from({ length: n }, () => ({ kind: 'IMAGE' }));
const video = { kind: 'VIDEO' };

describe('Médias d’un produit : dix photos et une vidéo', () => {
  it('les limites', () => {
    assert.deepEqual(PRODUCT_MEDIA_LIMITS, { photos: 10, videos: 1 });
  });
  it('dix photos et une vidéo : accepté', () => {
    assert.equal(mediaProblem([...photos(10), video]), null);
    assert.equal(mediaProblem([]), null);
  });
  it('onze photos : refusé', () => {
    assert.equal(mediaProblem(photos(11)), 'TOO_MANY_PHOTOS');
  });
  it('deux vidéos : refusé', () => {
    assert.equal(mediaProblem([...photos(3), video, video]), 'TOO_MANY_VIDEOS');
  });
});
