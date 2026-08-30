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
    "5a9db463e151052d055d5ee239497a230682dd103d2471c21fb25f9ad7c0e539",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [move(100, 100), line(100, 900), line(900, 900), line(900, 100), close],
  ),
  oracleCase(
    "acute-corner",
    "3098863a27fabe561ee9f74e6ad9b10a89583dcb826333f90b8a3a4fe9dfb23b",
    { minX: 100, minY: 100, maxX: 565, maxY: 950 },
    [move(100, 100), line(500, 950), line(565, 100), close],
  ),
  oracleCase(
    "overlapping-contours",
    "7f125b5e16c99f7b3d968c47e94ff84b6afbfbf605323da1c452c95bea0b9200",
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
    "b08ce78f01db8c214fb3e4fa46d87f1a29de5a4d218865f32f61d99aa83c7c88",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [move(100, 100), line(900, 900), line(100, 900), line(900, 100), close],
  ),
  oracleCase(
    "quadratic-oval",
    "2d402af986b36b02c3907c659cdf484d6ca0859f3034b87089af79311fe45e9d",
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
    "587198ef78e721d220f7195dc25cabbf53486f2dcf00d52dee27b676708f7188",
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
    "f2f430326568a4cea36a9a7a12a60be05597c9d7b08769757a8bd9b5fc30ffbc",
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
