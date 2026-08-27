import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import _compute_price_changes, _prices_equal


class TestPricesEqual(unittest.TestCase):
    def test_equal_numeric_and_string(self):
        self.assertTrue(_prices_equal(5000, "5000"))
        self.assertTrue(_prices_equal(5000.0, 5000))

    def test_not_equal(self):
        self.assertFalse(_prices_equal(5000, 5300))

    def test_missing_values_are_not_equal(self):
        self.assertFalse(_prices_equal(None, 5000))
        self.assertFalse(_prices_equal("", 5000))
        self.assertFalse(_prices_equal(5000, ""))


class TestComputePriceChanges(unittest.TestCase):
    def setUp(self):
        self.channel_links = {
            "다이아몬드 빵가루새우(투톤)": {
                "naver": {"id": "11060989411", "name": "다이아몬드...", "option_id": "31838214078", "option_name": "50g"},
                "coupang": {"id": "999", "name": "다이아몬드...", "vendor_item_id": "12345678"},
            }
        }

    def test_no_channel_link_is_skipped(self):
        old_rows = [{"온라인 상품명": "연결 안 된 상품", "네이버 판매가": 1000}]
        new_rows = [{"온라인 상품명": "연결 안 된 상품", "네이버 판매가": 2000}]
        self.assertEqual(_compute_price_changes(old_rows, new_rows, self.channel_links), [])

    def test_unchanged_price_is_skipped(self):
        old_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5000, "쿠팡 판매가": 7000}]
        new_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5000, "쿠팡 판매가": 7000}]
        self.assertEqual(_compute_price_changes(old_rows, new_rows, self.channel_links), [])

    def test_changed_price_produces_change_with_option_fields(self):
        old_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5000, "쿠팡 판매가": 7000}]
        new_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5300, "쿠팡 판매가": 7000}]
        changes = _compute_price_changes(old_rows, new_rows, self.channel_links)
        self.assertEqual(len(changes), 1)
        c = changes[0]
        self.assertEqual(c["channel"], "naver")
        self.assertEqual(c["old_price"], 5000)
        self.assertEqual(c["new_price"], 5300)
        self.assertEqual(c["option_id"], "31838214078")
        self.assertEqual(c["option_name"], "50g")
        self.assertIsNone(c["vendor_item_id"])

    def test_no_old_row_means_old_price_is_none(self):
        old_rows = []
        new_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5300, "쿠팡 판매가": 7000}]
        changes = _compute_price_changes(old_rows, new_rows, self.channel_links)
        channels = {c["channel"]: c for c in changes}
        self.assertIsNone(channels["naver"]["old_price"])
        self.assertEqual(channels["coupang"]["vendor_item_id"], "12345678")


if __name__ == "__main__":
    unittest.main()
