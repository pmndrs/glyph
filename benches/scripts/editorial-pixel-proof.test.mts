import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { launchProjectChromium } from './support/project-chromium.mts';
import { compareEditorialPngs, inspectEditorialPng } from './support/editorial-pixel-proof.mts';

test('decoded editorial pixels and exact differences match an independently authored two-pixel canvas', async () => {
  const browser = await launchProjectChromium({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    const makePng = async (rightColor: string, leftColor = '#ff0000', width = 2): Promise<Buffer> => {
      const encoded = await page.evaluate(
        ({ right, left, canvasWidth }) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvasWidth;
          canvas.height = 1;
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('Test browser has no 2D canvas');
          context.fillStyle = left;
          context.fillRect(0, 0, 1, 1);
          context.fillStyle = right;
          context.fillRect(1, 0, 1, 1);
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { right: rightColor, left: leftColor, canvasWidth: width },
      );
      if (encoded === undefined) throw new Error('Test browser did not encode PNG');
      return Buffer.from(encoded, 'base64');
    };
    const redBlack = await makePng('#000000');
    const redBlue = await makePng('#0000ff');
    const blackBlack = await makePng('#000000', '#000000');
    const onePixel = await makePng('#000000', '#ff0000', 1);
    const pixels = await inspectEditorialPng(page, redBlack);
    const expectedRgba = Buffer.from([255, 0, 0, 255, 0, 0, 0, 255]);
    assert.deepEqual(pixels, {
      width: 2,
      height: 1,
      rgbaSha256: createHash('sha256').update(expectedRgba).digest('hex'),
      foregroundPixels: 1,
      foregroundBounds: [0, 0, 0, 0],
    });
    const blankPixels = await inspectEditorialPng(page, blackBlack);
    assert.equal(blankPixels.foregroundPixels, 0);
    assert.equal(blankPixels.foregroundBounds, null);
    assert.deepEqual(await compareEditorialPngs(page, redBlack, redBlack), {
      differentPixels: 0,
      differentChannels: 0,
      maximumChannelDelta: 0,
      meanChannelDelta: 0,
      differenceBounds: null,
    });
    assert.deepEqual(await compareEditorialPngs(page, redBlack, redBlue), {
      differentPixels: 1,
      differentChannels: 1,
      maximumChannelDelta: 255,
      meanChannelDelta: 255 / 8,
      differenceBounds: [1, 0, 1, 0],
    });
    await assert.rejects(() => compareEditorialPngs(page, redBlack, onePixel), /dimensions differ/u);
  } finally {
    await browser.close();
  }
});
