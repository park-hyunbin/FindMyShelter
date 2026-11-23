import csv
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.scripts.prepare_tour_transactions import build_lookup, match_complex


class TourTransactionLookupTest(unittest.TestCase):
    def test_new_scene_uses_its_address_before_the_next_kapt_snapshot(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / 'complexes.csv'
            scenes = root / 'scenes.json'
            with snapshot.open('w', encoding='utf-8', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=['단지코드', '단지명', '법정동주소', '도로명주소'])
                writer.writeheader()
                writer.writerow({'단지코드': 'A10000001', '단지명': '한빛', '법정동주소': '경기도 성남시 분당구 정자동 10',
                                 '도로명주소': '경기도 성남시 분당구 성남대로 10'})
            scenes.write_text(json.dumps([
                {'id': 'new-scene', 'kaptCode': 'A10000001', 'name': '한빛아파트'},
                {'id': 'later-scene', 'kaptCode': 'A10000002', 'name': '푸른아파트', 'area': '서울 송파구 송이로31길 56'},
                {'id': 'missing-address', 'kaptCode': 'A10000003', 'name': '다른 단지'},
            ]), encoding='utf-8')
            regions, parcels, roads = build_lookup(snapshot, scenes)

        self.assertIn('later-scene', regions)
        self.assertNotIn('missing-address', regions)
        self.assertEqual('new-scene', match_complex({
            '단지명': '한빛', '시군구': '경기도 성남시 분당구 정자동', '번지': '', '도로명': '성남대로 10',
        }, parcels, roads))
        record = {'단지명': '푸른', '시군구': '서울특별시 송파구 문정동', '번지': '', '도로명': '송이로31길 56'}
        self.assertEqual('later-scene', match_complex(record, parcels, roads))
        self.assertIsNone(match_complex({**record, '시군구': '서울특별시 강남구 일원동'}, parcels, roads))
        leel = {'단지명': '잠실르엘', '시군구': '서울특별시 송파구 신천동', '번지': '17-6', '도로명': ''}
        self.assertEqual('jamsil-leel', match_complex(leel, parcels, roads))
        self.assertIsNone(match_complex({**leel, '번지': '17-7'}, parcels, roads))

    def test_woobang_matches_both_phases_to_one_management_complex(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / 'complexes.csv'
            scenes = root / 'scenes.json'
            snapshot.write_text('단지코드,단지명,법정동주소,도로명주소\n', encoding='utf-8')
            scenes.write_text('[]', encoding='utf-8')
            regions, parcels, roads = build_lookup(snapshot, scenes)
        region = 'gwangju-a10025136'
        self.assertEqual(regions.count(region), 1)
        for phase, lot, number in ((1, '1112', 70), (2, '1111', 74)):
            record = {'단지명': f'광주역우방아이유쉘{phase}단지', '시군구': '경기도 광주시 양벌동',
                      '번지': lot, '도로명': f'청석로 {number}'}
            self.assertEqual(match_complex({**record, '도로명': ''}, parcels, roads), region)
            self.assertEqual(match_complex({**record, '번지': ''}, parcels, roads), region)
            self.assertIsNone(match_complex({**record, '시군구': '경기도 광주시 신현동', '도로명': ''}, parcels, roads))
            self.assertIsNone(match_complex({**record, '단지명': '다른우방아이유쉘'}, parcels, roads))


if __name__ == '__main__':
    unittest.main()
