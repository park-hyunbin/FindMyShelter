import evidence from '../../public/datasets/regions/songpa/winter-capture.json';

const kst = new Date(Date.parse(evidence.acquiredAt) + 9 * 3_600_000).toISOString();
const date = kst.slice(0, 10);
const exactMinute = (Date.parse(kst) - Date.parse(`${date}T00:00:00Z`)) / 60_000;

export const songpaWinterCapture = {
  ...evidence,
  date,
  clock: kst.slice(11, 19),
  exactMinute,
  minute: Math.round(exactMinute),
  image: '/datasets/regions/songpa/winter-capture.png',
};
