const region = { innerWidth: 32, innerHeight: 32, paddingX: 4, paddingY: 4 };
const move = (x, y) => ({ kind: "move", x, y });
const line = (x, y) => ({ kind: "line", x, y });
const quadratic = (controlX, controlY, x, y) => ({
  kind: "quadratic",
  controlX,
  controlY,
  x,
  y,
});
const cubic = (control0X, control0Y, control1X, control1Y, x, y) => ({
  kind: "cubic",
  control0X,
  control0Y,
  control1X,
  control1Y,
  x,
  y,
});
const close = { kind: "close" };

function oracleCase(id, candidateSha256, bounds, commands) {
  return {
    id,
    candidateSha256,
    request: { unitsPerEm: 1_000, bounds, region, commands },
  };
}

export const mtsdfOracleCases = [
  oracleCase(
    "ordinary-square",
    "b936048f093edaa24295cec791cdf849542cf1a5c7c5e11619ab2463ae1c2e1a",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [move(100, 100), line(100, 900), line(900, 900), line(900, 100), close],
  ),
  oracleCase(
    "acute-corner",
    "d022f262cd74d84d9c137acbf995ec39ebe5bce6fa0633d8364e5c26e3a30fee",
    { minX: 100, minY: 100, maxX: 565, maxY: 950 },
    [move(100, 100), line(500, 950), line(565, 100), close],
  ),
  oracleCase(
    "overlapping-contours",
    "46b7082d9cbce107934524ca96badf3de22d09ddbdbd03080600ebb4be154e49",
    { minX: 100, minY: 100, maxX: 900, maxY: 800 },
    [
      move(100, 200),
      line(100, 800),
      line(600, 800),
      line(600, 200),
      close,
      move(400, 100),
      line(400, 700),
      line(900, 700),
      line(900, 100),
      close,
    ],
  ),
  oracleCase(
    "self-intersection",
    "2e820439400d48a893dbf526d0312bbca681404c383cb41e399269d33aec31bb",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [move(100, 100), line(900, 900), line(100, 900), line(900, 100), close],
  ),
  oracleCase(
    "quadratic-oval",
    "38b0eff76e6ee771f05fa6d9e4d837393717dc7c3c893b2e7283dd5759946bad",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [
      move(100, 500),
      quadratic(100, 900, 500, 900),
      quadratic(900, 900, 900, 500),
      quadratic(900, 100, 500, 100),
      quadratic(100, 100, 100, 500),
      close,
    ],
  ),
  oracleCase(
    "cubic-teardrop",
    "513d9d429851966d1cb3eeb0a29fdb511f6216f2a0a45eb7589a19a7d620e4f3",
    { minX: 80, minY: 100, maxX: 920, maxY: 950 },
    [
      move(500, 950),
      cubic(920, 740, 900, 210, 500, 100),
      cubic(100, 210, 80, 740, 500, 950),
      close,
    ],
  ),
  oracleCase(
    "complex-counter",
    "010698e276bcc493b45c8399465c5f3cb33bf2926dc73e858c9debbfd47075e2",
    { minX: 80, minY: 100, maxX: 920, maxY: 920 },
    [
      move(80, 100),
      line(380, 920),
      line(620, 920),
      line(920, 100),
      line(720, 100),
      line(650, 310),
      line(350, 310),
      line(280, 100),
      close,
      move(410, 480),
      line(590, 480),
      line(500, 760),
      close,
    ],
  ),
];
