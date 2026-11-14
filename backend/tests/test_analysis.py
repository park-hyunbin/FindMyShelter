import unittest

from app.analysis import GROUPS, unavailable_analysis


class AnalysisTests(unittest.TestCase):
    def test_missing_data_never_becomes_a_score_or_measurement(self):
        result = unavailable_analysis("서울특별시 테스트 주소")
        for group, fields in GROUPS.items():
            for field in fields:
                self.assertIsNone(result[group][field])
                self.assertEqual(result["evidence"][f"{group}.{field}"]["status"], "missing")
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["interpretation"]["strengths"], [])

    def test_empty_address_rejected(self):
        with self.assertRaises(ValueError):
            unavailable_analysis("   ")


if __name__ == "__main__":
    unittest.main()
