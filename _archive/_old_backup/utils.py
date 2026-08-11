import os
import json
import pandas as pd

SETTINGS_FILE = "settings.json"
MARGIN_DB_FILE = "saved_margin_data.csv"

def load_settings():
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"fee_naver": 5.8, "fee_coupang": 9.6, "fee_baemin": 3.0, "fee_lotteon": 11.2}

def save_settings(settings_dict):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings_dict, f)

def load_margin_db():
    if os.path.exists(MARGIN_DB_FILE):
        try: 
            df = pd.read_csv(MARGIN_DB_FILE, encoding='utf-8-sig')
            drop_cols = [c for c in df.columns if any(kw in str(c) for kw in ['커넥트', '아이스팩', 'Unnamed'])]
            df.drop(columns=drop_cols, inplace=True, errors='ignore')
            return df
        except: pass
    return None

def save_margin_db(df):
    if df is not None:
        df.to_csv(MARGIN_DB_FILE, index=False, encoding='utf-8-sig')

def get_blacklist():
    if os.path.exists("blacklist.txt"):
        with open("blacklist.txt", "r", encoding="utf-8") as f:
            return set(line.strip() for line in f if line.strip())
    return set()

def add_to_blacklist(order_ids):
    with open("blacklist.txt", "a", encoding="utf-8") as f:
        for oid in order_ids:
            f.write(f"{str(oid).strip()}\n")