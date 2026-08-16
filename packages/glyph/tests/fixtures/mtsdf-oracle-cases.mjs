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
    "dd2827d6ac0590d09c7f3b64a931373116ad5f41664743912ca185bf1548a4fa",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [move(100, 100), line(100, 900), line(900, 900), line(900, 100), close],
  ),
  oracleCase(
    "acute-corner",
    "548b86fbf64b41a726820022726b2eb161f0bc1e14bcea2b8ba16cd23784546e",
    { minX: 100, minY: 100, maxX: 565, maxY: 950 },
    [move(100, 100), line(500, 950), line(565, 100), close],
  ),
  oracleCase(
    "overlapping-contours",
    "eb788bcf9085a99eafe2db4e660bfa12d23086235fe4baf1dc93ff9acebaf92f",
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
    "668faa638aafa6b5d90b09d66270bed6bb9812878043e84eaa1c7f700f94189b",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [move(100, 100), line(900, 900), line(100, 900), line(900, 100), close],
  ),
  oracleCase(
    "quadratic-oval",
    "bccdda7a0d18fa52d8f1ce67e2ede58004baefbf382f106a1c9a70435c8870f6",
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
    "631f40fd9b6731d80afd168967665a1c2606022fed9d28330bab2b199140bd3d",
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
    "0873435f984af200558e11378d2c5589a14dbdb4bad29077c2504d2489c409d0",
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
