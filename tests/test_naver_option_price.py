import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from apis import naver_api


class TestMatchOptionCombination(unittest.TestCase):
    def setUp(self):
        self.combinations = [
            {"id": 111, "optionName1": "30g", "price": 0},
            {"id": 222, "optionName1": "50g", "price": 300},
        ]

    def test_match_by_id(self):
        found = naver_api._match_option_combination(self.combinations, "222", "이름은틀림")
        self.assertEqual(found["id"], 222)

    def test_fallback_to_name_when_id_not_found(self):
        found = naver_api._match_option_combination(self.combinations, "999", "50g")
        self.assertEqual(found["id"], 222)

    def test_no_match_returns_none(self):
        found = naver_api._match_option_combination(self.combinations, "999", "없는옵션")
        self.assertIsNone(found)

    def test_no_option_id_uses_name_directly(self):
        found = naver_api._match_option_combination(self.combinations, None, "30g")
        self.assertEqual(found["id"], 111)


class TestUpdateNaverOptionPrices(unittest.TestCase):
    def _detail_response(self):
        res = MagicMock()
        res.status_code = 200
        res.json.return_value = {
            "originProduct": {
                "originProductNo": "9999",
                "name": "테스트상품",
                "salePrice": 5000,
                "stockQuantity": 10,
                "detailContent": "내용",
                "detailAttribute": {},
                "deliveryInfo": {},
                "optionInfo": {
                    "optionCombinations": [
                        {"id": 111, "optionName1": "30g", "price": 0},
                        {"id": 222, "optionName1": "50g", "price": 300},
                    ]
                },
            }
        }
        return res

    @patch.object(naver_api, "get_access_token", return_value="tok")
    @patch.object(naver_api, "_request")
    def test_batches_multiple_options_into_one_get_and_one_put(self, mock_request, mock_token):
        get_res = self._detail_response()
        put_res = MagicMock()
        put_res.status_code = 200
        mock_request.side_effect = [get_res, put_res]

        results = naver_api.update_naver_option_prices("channel1", [
            {"option_id": "111", "option_name": "30g", "new_price": 5100},
            {"option_id": "222", "option_name": "50g", "new_price": 5400},
        ])

        self.assertEqual(mock_request.call_count, 2)  # GET 1회 + PUT 1회
        self.assertTrue(all(r["success"] for r in results))

        put_call = mock_request.call_args_list[1]
        self.assertEqual(put_call.args[0], "PUT")
        sent_payload = put_call.kwargs["json"]
        combos_by_id = {c["id"]: c for c in sent_payload["optionInfo"]["optionCombinations"]}
        self.assertEqual(combos_by_id[111]["price"], 5100 - 5000)
        self.assertEqual(combos_by_id[222]["price"], 5400 - 5000)

    @patch.object(naver_api, "get_access_token", return_value="tok")
    @patch.object(naver_api, "_request")
    def test_fallback_match_reports_matched_option_id(self, mock_request, mock_token):
        get_res = self._detail_response()
        put_res = MagicMock()
        put_res.status_code = 200
        mock_request.side_effect = [get_res, put_res]

        # option_id가 안 맞아서 이름("50g")으로 폴백 매칭돼야 함
        results = naver_api.update_naver_option_prices("channel1", [
            {"option_id": "stale-id", "option_name": "50g", "new_price": 5400},
        ])

        self.assertTrue(results[0]["success"])
        self.assertEqual(results[0]["matched_option_id"], 222)

    @patch.object(naver_api, "get_access_token", return_value="tok")
    @patch.object(naver_api, "_request")
    def test_unmatched_option_fails_without_blocking_others(self, mock_request, mock_token):
        get_res = self._detail_response()
        put_res = MagicMock()
        put_res.status_code = 200
        mock_request.side_effect = [get_res, put_res]

        results = naver_api.update_naver_option_prices("channel1", [
            {"option_id": "111", "option_name": "30g", "new_price": 5100},
            {"option_id": "no-match", "option_name": "없는옵션", "new_price": 9999},
        ])

        self.assertTrue(results[0]["success"])
        self.assertFalse(results[1]["success"])
        self.assertIn("옵션을 찾을 수 없음", results[1]["message"])


class TestUpdateNaverSalePrice(unittest.TestCase):
    @patch.object(naver_api, "get_access_token", return_value="tok")
    @patch.object(naver_api, "_request")
    def test_updates_sale_price_only(self, mock_request, mock_token):
        get_res = MagicMock()
        get_res.status_code = 200
        get_res.json.return_value = {"originProduct": {
            "originProductNo": "9999", "name": "테스트상품", "salePrice": 5000,
            "stockQuantity": 10, "detailContent": "내용", "detailAttribute": {}, "deliveryInfo": {},
        }}
        put_res = MagicMock()
        put_res.status_code = 200
        mock_request.side_effect = [get_res, put_res]

        ok, msg = naver_api.update_naver_sale_price("channel1", 6000)

        self.assertTrue(ok)
        put_call = mock_request.call_args_list[1]
        self.assertEqual(put_call.kwargs["json"]["salePrice"], 6000)


if __name__ == "__main__":
    unittest.main()
