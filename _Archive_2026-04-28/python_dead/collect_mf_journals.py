"""
collect_mf_journals.py
MCPのtool-result JSONファイル（または直接JSON文字列）から仕訳データを読み込み、
会社別のVaultファイルに追記・マージするスクリプト。

使い方:
  python collect_mf_journals.py --file <tool_result_path> --company <company_id> --vault <vault_path>
  python collect_mf_journals.py --merge --output <output_path>
"""

import json
import sys
import os
import argparse
import glob
from pathlib import Path

VAULT_BASE = r"C:\ClaudeSync\02_CFO"
COMPANIES = {
    "LOC":        r"C:\ClaudeSync\02_CFO\Vault_LOC\Journal_Full.json",
    "SankaHD":    r"C:\ClaudeSync\02_CFO\Vault_SankaHD\Journal_Full.json",
    "Friends":    r"C:\ClaudeSync\02_CFO\Vault_Friends\Journal_Full.json",
    "Yawatanishi":r"C:\ClaudeSync\02_CFO\Vault_MedSanka_Yawatanishi\Journal_Full.json",
    "Carproad":   r"C:\ClaudeSync\02_CFO\Vault_MedSanka_Carproad\Journal_Full.json",
    "Luna":       r"C:\ClaudeSync\02_CFO\Vault_MedSanka_Luna\Journal_Full.json",
    "Heiwa":      r"C:\ClaudeSync\02_CFO\Vault_MedSanka_Heiwa\Journal_Full.json",
    "Tagline":    r"C:\ClaudeSync\02_CFO\Vault_Tagline\Journal_Full.json",
}


def load_mcp_tool_result(file_path: str) -> dict:
    """MCPのtool-resultファイルまたは直接JSONファイルを読み込む"""
    with open(file_path, encoding='utf-8') as f:
        raw = json.load(f)

    # tool-result形式: [{type: "text", text: "..."}]
    if isinstance(raw, list) and raw and 'text' in raw[0]:
        text = raw[0]['text']
        return json.loads(text)
    # 直接JSONの場合
    return raw


def append_to_vault(data: dict, company_id: str, vault_path: str, page: int):
    """仕訳データをVaultファイルに追記する"""
    new_journals = data.get('journals', [])
    metadata = data.get('metadata', {})

    if os.path.exists(vault_path):
        with open(vault_path, encoding='utf-8') as f:
            store = json.load(f)
    else:
        store = {
            'company_id': company_id,
            'fetch_period': {'start': '2026-01-29', 'end': '2026-04-16'},
            'journals': [],
            'total_count': 0,
            'total_pages': 0,
            'fetched_pages': []
        }

    # 重複ページのチェック（同じpageを二重追記しない）
    if page in store.get('fetched_pages', []):
        print(f"[{company_id}] Page {page} already fetched. Skipping.")
        return len(store['journals']), store['total_count']

    store['journals'].extend(new_journals)
    store['total_count'] = metadata.get('total_count', store['total_count'])
    store['total_pages'] = metadata.get('total_pages', store['total_pages'])
    store.setdefault('fetched_pages', []).append(page)
    store['fetched_pages'].sort()

    with open(vault_path, 'w', encoding='utf-8') as f:
        json.dump(store, f, ensure_ascii=False, indent=2)

    stored = len(store['journals'])
    total = store['total_count']
    pages_done = store['fetched_pages']
    print(f"[{company_id}] Page {page}: +{len(new_journals)} journals | "
          f"Stored: {stored}/{total} | Pages fetched: {pages_done}")
    return stored, total


def merge_all(output_path: str):
    """全社のVaultファイルをMF_Settlement_Full.jsonにマージする"""
    result = {
        'description': 'さんかグループ全社 仕訳データ (2026-01-29 ~ 2026-04-16)',
        'generated_at': '2026-04-16',
        'companies': {}
    }

    grand_total = 0
    for company_id, vault_path in COMPANIES.items():
        if os.path.exists(vault_path):
            with open(vault_path, encoding='utf-8') as f:
                data = json.load(f)
            count = len(data.get('journals', []))
            total = data.get('total_count', 0)
            pages_done = data.get('fetched_pages', [])
            result['companies'][company_id] = {
                'stored_count': count,
                'total_count': total,
                'pages_fetched': pages_done,
                'complete': count >= total,
                'vault_path': vault_path
            }
            grand_total += count
            print(f"[{company_id}] {count}/{total} journals, pages: {pages_done}, complete: {count >= total}")
        else:
            result['companies'][company_id] = {
                'stored_count': 0,
                'total_count': 0,
                'complete': False,
                'error': 'vault file not found'
            }
            print(f"[{company_id}] NOT FOUND")

    result['grand_total_stored'] = grand_total
    result['summary'] = {k: v['stored_count'] for k, v in result['companies'].items()}

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n=== MERGE COMPLETE ===")
    print(f"Grand total stored: {grand_total} journals")
    print(f"Output: {output_path}")
    return grand_total


def status():
    """全社の取得状況を表示する"""
    print("\n=== MF仕訳取得状況 ===")
    grand = 0
    for company_id, vault_path in COMPANIES.items():
        if os.path.exists(vault_path):
            with open(vault_path, encoding='utf-8') as f:
                data = json.load(f)
            count = len(data.get('journals', []))
            total = data.get('total_count', 0)
            pages = data.get('fetched_pages', [])
            pct = f"{count/total*100:.0f}%" if total > 0 else "N/A"
            flag = "✓" if count >= total else "..."
            print(f"  {flag} {company_id:15s}: {count:4d}/{total:4d} ({pct}) pages={pages}")
            grand += count
        else:
            print(f"  ✗ {company_id:15s}: not started")
    print(f"  {'TOTAL':15s}: {grand} journals stored")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', help='tool-result JSONファイルのパス')
    parser.add_argument('--company', help='会社ID (LOC, SankaHD, ...)')
    parser.add_argument('--vault', help='Vault出力パス (省略時は自動)')
    parser.add_argument('--page', type=int, default=1, help='取得したページ番号')
    parser.add_argument('--merge', action='store_true', help='全社マージモード')
    parser.add_argument('--status', action='store_true', help='取得状況確認')
    parser.add_argument('--output', default=r'C:\ClaudeSync\02_CFO\MF_Settlement_Full.json',
                        help='マージ出力パス')
    args = parser.parse_args()

    if args.status:
        status()
        return

    if args.merge:
        merge_all(args.output)
        return

    if not args.file or not args.company:
        parser.print_help()
        sys.exit(1)

    vault_path = args.vault or COMPANIES.get(args.company)
    if not vault_path:
        print(f"Error: Unknown company '{args.company}'. Use --vault to specify path.")
        sys.exit(1)

    # Vaultディレクトリが存在しない場合は作成
    os.makedirs(os.path.dirname(vault_path), exist_ok=True)

    data = load_mcp_tool_result(args.file)
    append_to_vault(data, args.company, vault_path, args.page)


if __name__ == '__main__':
    main()
