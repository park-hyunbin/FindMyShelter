import type { StreetFacade } from '../opo-street-exterior';
import type { NeighborhoodPalette } from '../opo-neighborhood-facade';

export const songpaStreets = {
  roadview: 'https://map.kakao.com/link/roadview/37.4979588,127.1171789',
  views: [
    { id: 'yangjae-junction', name: '양재대로60길 교차로', position: [127.1169738, 37.4981307], lookAt: [127.1170780, 37.4980100] },
    { id: 'yangjae-arterial', name: '양재대로 차로', position: [127.1168590, 37.4991910], lookAt: [127.1162742, 37.4988761] },
  ],
};

// Exterior cues referenced by songpaStreets.roadview, keyed by GIS footprints.
export const songpaStreetFacades = new Map<string, StreetFacade>([
  ['55757101', { wall: '#a39184', roof: '#6e8e80', edge: '#d0c6b8', glass: '#546d73', lower: '#6d6760',
    front: [127.116994, 37.498151], balconies: true, storefront: true }],
  ['55781807', { wall: '#a39188', roof: '#858880', edge: '#c5beb5', glass: '#586f73', lower: '#817974',
    front: [127.117202, 37.497954], balconies: true, storefront: false }],
  ['69803784', { wall: '#c7c1b7', roof: '#92938e', edge: '#b3ada3', glass: '#50676b', lower: '#7b7771',
    front: [127.116839, 37.498395], balconies: false, storefront: true }],
]);

// Shared finishes for the adjacent complexes, based on the photographed street elevations.
export const songpaNeighborApartments = new Map<string, NeighborhoodPalette>([
  ['가락금호아파트', { wall: '#e0e3e0', trim: '#c6cfcb', glass: '#637c86', roof: '#8b9390', accent: '#819cae' }],
  ['가락우성아파트', { wall: '#e4dbcf', trim: '#cfc0af', glass: '#637475', roof: '#9caa8c', accent: '#ae8e75' }],
]);
