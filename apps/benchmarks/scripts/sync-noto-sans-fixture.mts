import { resolve } from 'node:path';

import { syncImmutableFixture } from './support/immutable-fixture.mts';

// google/fonts ships Noto as variable, which the baker rejects outright with
// UnsupportedVariableFont. The Noto project's own site repository carries hinted
// static builds of every script, so the fixture takes them from there and no
// font instancer — and no Python — enters the repository.
const commit = '3a06b1c521155492df224d33464b3c7b2852d861';
const directory = resolve('fixtures/fonts/noto-sans-v2026');
const check = process.argv.includes('--check');
const files = [
  {
    localName: 'NotoSans-Regular.ttf',
    remotePath: 'fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf',
    sha256: '478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823',
  },
  {
    localName: 'NotoSansArabic-Regular.ttf',
    remotePath: 'fonts/NotoSansArabic/hinted/ttf/NotoSansArabic-Regular.ttf',
    sha256: 'bdff3e5659d67e67def05b33f749683b9376ae819d65d3dd62ac4640b3aaef48',
  },
  {
    localName: 'NotoSansDevanagari-Regular.ttf',
    remotePath: 'fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf',
    sha256: '306b53ecfb182a504dd8a7446093c316387d2fd8dc350d0792ed1753fe0996cd',
  },
  {
    localName: 'NotoSansHebrew-Regular.ttf',
    remotePath: 'fonts/NotoSansHebrew/hinted/ttf/NotoSansHebrew-Regular.ttf',
    sha256: 'cdefaf8efd47045f6820928eba84db5bed7557539328952b5f828315485e02ee',
  },
  {
    localName: 'NotoSansThai-Regular.ttf',
    remotePath: 'fonts/NotoSansThai/hinted/ttf/NotoSansThai-Regular.ttf',
    sha256: '61cf814eec46b294d6ea4401ac295d0cecd5207bd2331dcc5a15e7301d30ee44',
  },
  {
    localName: 'NotoSansGeorgian-Regular.ttf',
    remotePath: 'fonts/NotoSansGeorgian/hinted/ttf/NotoSansGeorgian-Regular.ttf',
    sha256: 'd3e33254b09e7bb2c5cf0f17e554b80462056c5a107097f258d495168c3a9346',
  },
  {
    localName: 'NotoSansArmenian-Regular.ttf',
    remotePath: 'fonts/NotoSansArmenian/hinted/ttf/NotoSansArmenian-Regular.ttf',
    sha256: '720df88c332417a235b4d6209d14ec2e2bf4bfe2a954b7453d869ea593bfce1e',
  },
  {
    localName: 'NotoSansBengali-Regular.ttf',
    remotePath: 'fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Regular.ttf',
    sha256: 'b55c62ee531e3214da6c0701daecea89a52ba42db7d8206b92e6b51f397a3193',
  },
  {
    localName: 'NotoSansTamil-Regular.ttf',
    remotePath: 'fonts/NotoSansTamil/hinted/ttf/NotoSansTamil-Regular.ttf',
    sha256: '3c0a186feb3c63c7f6d63e1511dcdc144e745ae09b98e217c83f3e317974f6f9',
  },
  {
    localName: 'NotoSansTelugu-Regular.ttf',
    remotePath: 'fonts/NotoSansTelugu/hinted/ttf/NotoSansTelugu-Regular.ttf',
    sha256: 'b274780b69d1d23fe84b55e809a152cb2ac5306d33864b1f87622f6971871aae',
  },
  {
    localName: 'NotoSansKhmer-Regular.ttf',
    remotePath: 'fonts/NotoSansKhmer/hinted/ttf/NotoSansKhmer-Regular.ttf',
    sha256: 'e66675f2082788f0511a714bef5a1748928294b38c8e286a96ea73a864b5e605',
  },
  {
    localName: 'NotoSansLao-Regular.ttf',
    remotePath: 'fonts/NotoSansLao/hinted/ttf/NotoSansLao-Regular.ttf',
    sha256: '0a86e5e1ccfe34ca78c43fac6829dc751b42bcc469272a9a55325aae587bfbe7',
  },
  {
    localName: 'NotoSansMyanmar-Regular.ttf',
    remotePath: 'fonts/NotoSansMyanmar/hinted/ttf/NotoSansMyanmar-Regular.ttf',
    sha256: 'fafce4db400bc0b214907ccdbfb0ad2f18a57bfefd08c8a571830b84088cf2fc',
  },
  {
    localName: 'NotoSansSinhala-Regular.ttf',
    remotePath: 'fonts/NotoSansSinhala/hinted/ttf/NotoSansSinhala-Regular.ttf',
    sha256: '9e32612d47004552f3125e78648a9e2e7899a216ccd3cefbb93a9b5f4c809feb',
  },
  {
    localName: 'NotoSansEthiopic-Regular.ttf',
    remotePath: 'fonts/NotoSansEthiopic/hinted/ttf/NotoSansEthiopic-Regular.ttf',
    sha256: 'f6f7fc379db9438959a2b0527e7a2cf36ea9c84626d56ec444fff37fc24c3c10',
  },
  {
    localName: 'NotoSansGujarati-Regular.ttf',
    remotePath: 'fonts/NotoSansGujarati/hinted/ttf/NotoSansGujarati-Regular.ttf',
    sha256: '9b5a7aaeeb649a2e75a49d8b006a1f87db1b61c0df3b001609f4e0725d88dbf6',
  },
  {
    localName: 'NotoSansKannada-Regular.ttf',
    remotePath: 'fonts/NotoSansKannada/hinted/ttf/NotoSansKannada-Regular.ttf',
    sha256: '9ad74dc64838c6855b96f671fc08e425a58921b9d0c71712ea79c328a27e6e38',
  },
  {
    localName: 'NotoSansMalayalam-Regular.ttf',
    remotePath: 'fonts/NotoSansMalayalam/hinted/ttf/NotoSansMalayalam-Regular.ttf',
    sha256: 'c08de7fa8d032a5d6a4d120fb82c78cec60b362a4e73fa26360d89759ff2a7f9',
  },
  {
    localName: 'NotoSansGurmukhi-Regular.ttf',
    remotePath: 'fonts/NotoSansGurmukhi/hinted/ttf/NotoSansGurmukhi-Regular.ttf',
    sha256: '658d0207da305a1411c539a8b0bbeda64d4146e54fb4827facddb890b6b90d74',
  },
  {
    localName: 'NotoSansOriya-Regular.ttf',
    remotePath: 'fonts/NotoSansOriya/hinted/ttf/NotoSansOriya-Regular.ttf',
    sha256: 'a16645d056017927406546aa78e4ce15e782fd8783467267b75450453d007415',
  },
] as const;

await syncImmutableFixture({
  baseUrl: `https://raw.githubusercontent.com/notofonts/notofonts.github.io/${commit}`,
  check,
  directory,
  files,
});

/* @workflow
{
  "name": "font:noto-sans:sync",
  "summary": "Synchronize the authenticated Noto Sans static fixtures for every scripted language.",
  "requirements": "Network access to the pinned source.",
  "writes": "Checked-in static fonts."
}
*/
