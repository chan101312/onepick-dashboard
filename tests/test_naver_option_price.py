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


if __name__ == "__main__":
    unittest.main()
