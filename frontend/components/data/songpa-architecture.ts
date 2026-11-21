export type TowerExterior = {
  endFaces: number[];
  numberFaces: number[];
  roofRadiusM: number;
  blueSpandrels?: boolean;
  ribbedBase?: { faces: number[]; heightM: number };
};

export const songpaArchitecture = {
  photos: 'https://hogangnono.com/apt/1Zfb4',
  layout: 'https://m.richgo.ai/api/og/danji-map/a9phoJw',
  builder: 'https://www.centreville.co.kr/construction/movein_view?seq=24',
  basicPlans: 'https://kbland.kr/se/c/1953',
  planTypes: [
    { area: 141, url: 'https://file.kbland.kr/image/kbstar/land/img/alian/kms/complex/plane/basic/objctidnfr/KBM002223/2223_1_20210113194114.jpg' },
    { area: 170, url: 'https://file.kbland.kr/image/kbstar/land/img/alian/kms/complex/plane/basic/objctidnfr/KBM002223/2223_2_20210113194114.jpg' },
  ],
  towers: new Map<string, TowerExterior>([
    // Edge indices refer to the ordered outer rings in the current Songpa building dataset.
    ['55765286', { endFaces: [0, 11, 22], numberFaces: [11], roofRadiusM: 4.6 }],
    ['55765487', { endFaces: [10, 22, 34], numberFaces: [10], roofRadiusM: 4.4 }],
    // The playground photo shows the lower ribbed panels and numbers on the two facing ends.
    ['55765541', { endFaces: [0, 11, 22], numberFaces: [11, 22], roofRadiusM: 4.6, blueSpandrels: true,
      ribbedBase: { faces: [22], heightM: 4.2 } }],
    ['55765485', { endFaces: [0, 10], numberFaces: [0], roofRadiusM: 3.1, blueSpandrels: true,
      ribbedBase: { faces: [0], heightM: 4.2 } }],
    ['55765284', { endFaces: [0, 10], numberFaces: [10], roofRadiusM: 3.4 }],
  ]),
};
