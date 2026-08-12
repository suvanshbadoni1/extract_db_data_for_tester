const { parseB0TokenTags, maskPAN } = require('../ptlf-parser');
const { getServerPort } = require('../server');

describe('PTLF parser utilities', () => {
  test('maskPAN keeps prefix and suffix visible while masking the middle', () => {
    expect(maskPAN('4111111111111111')).toBe('411111******1111');
    expect(maskPAN('123456')).toBe('123456');
  });

  test('parseB0TokenTags extracts card number and masked value from BNET token', () => {
    const cardNumber = '4111111111111111';
    const tokenB0 = '0'.repeat(164) + cardNumber + '0'.repeat(180 - 164 - cardNumber.length);
    const padded = '0000BNET' + tokenB0.slice(8);

    const parsed = parseB0TokenTags(padded);

    expect(parsed.FIID).toBe('BNET');
    expect(parsed.CARD_NUMBER).toBe(cardNumber);
    expect(parsed.masked_card_number).toBe('411111******1111');
  });
});

describe('server configuration', () => {
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });

  test('returns the environment override when PORT is set', () => {
    process.env.PORT = '4500';
    expect(getServerPort()).toBe(4500);
  });

  test('falls back to the default application port when PORT is not set', () => {
    delete process.env.PORT;
    expect(getServerPort()).toBe(4000);
  });
});
