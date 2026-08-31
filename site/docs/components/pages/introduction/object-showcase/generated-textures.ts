function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const GRID_TEXTURE_URL = svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="750" height="550" viewBox="0 0 1500 1100">
    <defs>
      <pattern id="minor" width="100" height="100" patternUnits="userSpaceOnUse">
        <path d="M100 0H0V100" fill="none" stroke="#b8c4d1" stroke-width="2.5"/>
      </pattern>
      <pattern id="major" width="500" height="500" patternUnits="userSpaceOnUse">
        <rect width="500" height="500" fill="url(#minor)"/>
        <path d="M500 0H0V500" fill="none" stroke="#778ba3" stroke-width="5"/>
      </pattern>
    </defs>
    <rect width="1500" height="1100" fill="#fffaf7"/>
    <rect width="1500" height="1100" fill="url(#major)"/>
  </svg>
`);

export const SKY_TEXTURE_URL = svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="8" height="1024" viewBox="0 0 8 1024">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#197fd7"/>
        <stop offset="0.16" stop-color="#59baf2"/>
        <stop offset="0.3" stop-color="#ffc7dc"/>
        <stop offset="0.42" stop-color="#ffe0c3"/>
        <stop offset="0.62" stop-color="#fff1df"/>
        <stop offset="1" stop-color="#fff6ec"/>
      </linearGradient>
    </defs>
    <rect width="8" height="1024" fill="url(#sky)"/>
  </svg>
`);
