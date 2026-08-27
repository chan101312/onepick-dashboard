import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from apis import coupang_api


class TestRoundPriceTo10(unittest.TestCase):
    def test_rounds_to_nearest_10(self):
        self.assertEqual(coupang_api._round_price_to_10(5304), 5300)
        self.assertEqual(coupang_api._round_price_to_10(5305), 5310)
        self.assertEqual(coupang_api._round_price_to_10(5300), 5300)


class TestUpdateCoupangItemPrice(unittest.TestCase):
    @patch.object(coupang_api, "VENDOR_ID", "v1")
    @patch.object(coupang_api, "ACCESS_KEY", "a1")
    @patch.object(coupang_api, "SECRET_KEY", "s1")
    @patch.object(coupang_api, "_request")
    def test_success(self, mock_request):
        mock_res = MagicMock()
        mock_res.status_code = 200
        mock_request.return_value = mock_res

        ok, msg = coupang_api.update_coupang_item_price("12345678", 5304)

        self.assertTrue(ok)
        called_url = mock_request.call_args.args[1]
        self.assertIn("/vendor-items/12345678/prices/5300", called_url)

    @patch.object(coupang_api, "VENDOR_ID", "v1")
    @patch.object(coupang_api, "ACCESS_KEY", "a1")
    @patch.object(coupang_api, "SECRET_KEY", "s1")
    @patch.object(coupang_api, "_request")
    def test_failure_returns_message(self, mock_request):
        mock_res = MagicMock()
        mock_res.status_code = 400
        mock_res.text = "가격 변경 제한 초과"
        mock_request.return_value = mock_res

        ok, msg = coupang_api.update_coupang_item_price("12345678", 5304)

        self.assertFalse(ok)
        self.assertIn("가격 변경 제한 초과", msg)

    def test_missing_credentials(self):
        with patch.object(coupang_api, "VENDOR_ID", None):
            ok, msg = coupang_api.update_coupang_item_price("12345678", 5304)
            self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
