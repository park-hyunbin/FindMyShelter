type TowerExterior = { endFaces: number[]; numberFace: number; roofRadiusM: number };

export const songpaArchitecture = {
  photos: 'https://hogangnono.com/apt/1Zfb4',
  layout: 'https://m.richgo.ai/api/og/danji-map/a9phoJw',
  towers: new Map<string, TowerExterior>([
    // Edge indices refer to the ordered outer rings in the current Songpa building dataset.
    ['55765286', { endFaces: [0, 11, 22], numberFace: 11, roofRadiusM: 4.6 }],
    ['55765487', { endFaces: [10, 22, 34], numberFace: 10, roofRadiusM: 4.4 }],
    ['55765541', { endFaces: [0, 11, 22], numberFace: 11, roofRadiusM: 4.6 }],
    ['55765485', { endFaces: [0, 10], numberFace: 0, roofRadiusM: 3.1 }],
    ['55765284', { endFaces: [0, 10], numberFace: 10, roofRadiusM: 3.4 }],
  ]),
};
