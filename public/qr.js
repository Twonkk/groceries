(function () {
  const VERSION = 4;
  const SIZE = 21 + (VERSION - 1) * 4;
  const DATA_CODEWORDS = 80;
  const EC_CODEWORDS = 20;
  const MASK = 0;
  const FORMAT_ECL_LOW = 1;

  const EXP = new Array(512);
  const LOG = new Array(256);

  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];

  function multiply(a, b) {
    return a && b ? EXP[LOG[a] + LOG[b]] : 0;
  }

  function generatorPolynomial(degree) {
    let result = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = new Array(result.length + 1).fill(0);
      for (let j = 0; j < result.length; j += 1) {
        next[j] ^= result[j];
        next[j + 1] ^= multiply(result[j], EXP[i]);
      }
      result = next;
    }
    return result;
  }

  function reedSolomon(data, degree) {
    const generator = generatorPolynomial(degree).slice(1);
    const result = new Array(degree).fill(0);

    for (const byte of data) {
      const factor = byte ^ result.shift();
      result.push(0);
      for (let i = 0; i < degree; i += 1) {
        result[i] ^= multiply(generator[i], factor);
      }
    }

    return result;
  }

  function pushBits(bits, value, width) {
    for (let i = width - 1; i >= 0; i -= 1) bits.push(((value >>> i) & 1) === 1);
  }

  function dataCodewords(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    if (bytes.length > 78) throw new Error("URL is too long for this QR code.");

    const bits = [];
    pushBits(bits, 0x4, 4);
    pushBits(bits, bytes.length, 8);
    for (const byte of bytes) pushBits(bits, byte, 8);

    const capacity = DATA_CODEWORDS * 8;
    const terminator = Math.min(4, capacity - bits.length);
    for (let i = 0; i < terminator; i += 1) bits.push(false);
    while (bits.length % 8) bits.push(false);

    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let value = 0;
      for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i + j] ? 1 : 0);
      words.push(value);
    }

    for (let pad = 0xec; words.length < DATA_CODEWORDS; pad ^= 0xec ^ 0x11) {
      words.push(pad);
    }

    return words;
  }

  function formatBits() {
    const data = (FORMAT_ECL_LOW << 3) | MASK;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) {
      remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) ? 0x537 : 0);
    }
    return ((data << 10) | remainder) ^ 0x5412;
  }

  function createMatrix(text) {
    const modules = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
    const reserved = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));

    function inBounds(col, row) {
      return col >= 0 && col < SIZE && row >= 0 && row < SIZE;
    }

    function setFunction(col, row, dark) {
      if (!inBounds(col, row)) return;
      modules[row][col] = dark;
      reserved[row][col] = true;
    }

    function drawFinder(col, row) {
      for (let y = -1; y <= 7; y += 1) {
        for (let x = -1; x <= 7; x += 1) {
          const xx = col + x;
          const yy = row + y;
          const isFinder = x >= 0 && x <= 6 && y >= 0 && y <= 6;
          const dark = isFinder && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
          setFunction(xx, yy, dark);
        }
      }
    }

    function drawAlignment(col, row) {
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          setFunction(col + x, row + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }

    drawFinder(0, 0);
    drawFinder(SIZE - 7, 0);
    drawFinder(0, SIZE - 7);
    drawAlignment(26, 26);

    for (let i = 0; i < SIZE; i += 1) {
      if (!reserved[6][i]) setFunction(i, 6, i % 2 === 0);
      if (!reserved[i][6]) setFunction(6, i, i % 2 === 0);
    }

    const format = formatBits();
    const bit = (index) => ((format >>> index) & 1) === 1;
    for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(i));
    setFunction(8, 7, bit(6));
    setFunction(8, 8, bit(7));
    setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) setFunction(SIZE - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) setFunction(8, SIZE - 15 + i, bit(i));
    setFunction(8, SIZE - 8, true);

    const data = dataCodewords(text);
    const codewords = data.concat(reedSolomon(data, EC_CODEWORDS));
    const dataBits = [];
    for (const word of codewords) pushBits(dataBits, word, 8);

    let index = 0;
    let upward = true;
    for (let right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) right -= 1;
      for (let vert = 0; vert < SIZE; vert += 1) {
        const row = upward ? SIZE - 1 - vert : vert;
        for (let j = 0; j < 2; j += 1) {
          const col = right - j;
          if (reserved[row][col]) continue;
          let dark = index < dataBits.length ? dataBits[index] : false;
          if ((row + col) % 2 === 0) dark = !dark;
          modules[row][col] = dark;
          index += 1;
        }
      }
      upward = !upward;
    }

    return modules;
  }

  window.createQrSvg = function createQrSvg(text) {
    const modules = createMatrix(text);
    const border = 4;
    const moduleSize = 8;
    const viewSize = (SIZE + border * 2) * moduleSize;
    const rects = [];

    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (modules[row][col]) {
          rects.push(`<rect x="${(col + border) * moduleSize}" y="${(row + border) * moduleSize}" width="${moduleSize}" height="${moduleSize}"/>`);
        }
      }
    }

    return `
      <svg class="qr" viewBox="0 0 ${viewSize} ${viewSize}" role="img" aria-label="QR code">
        <rect width="100%" height="100%" fill="#fff"/>
        <g fill="#111">${rects.join("")}</g>
      </svg>
    `;
  };
})();
