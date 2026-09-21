import os
import json
import requests
from bs4 import BeautifulSoup
from sleeper_wrapper import Players
from pymongo import MongoClient
import certifi
from tqdm import tqdm

# Directory this script lives in, so the JSON snapshot always lands next to
# the script regardless of the working directory it's invoked from (matters
# for the scheduled GitHub Actions run).
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "players_data.json")

# API calls to sleeper
players_api = Players()
sleeperData = players_api.get_all_players()

def cleanPlayerIdString(playerId):
    return playerId.lower().replace("jr.", "").replace("sr.", "").replace("iii", "").replace("ii", "").replace(" ", "")\
        .replace(".", "").replace("-", "").replace("'", "")

# Creates a dict of sleeper ids mapped to name ids
def getSleeperData():
    temp = {}
    for playerId, value in sleeperData.items():
        if value['active']:
            sleepervalue = cleanPlayerIdString(str(value['first_name'] + value['last_name'] + str(value['position'])))
            temp[sleepervalue] = playerId
            # Handle edge cases
            if value['first_name'] == 'Phillip':
                sleepervalue = cleanPlayerIdString(str('pj' + value['last_name'] + str(value['position'])).lower())
                temp[sleepervalue] = playerId
            if value['first_name'] == 'Christopher':
                sleepervalue = cleanPlayerIdString(str('chris' + value['last_name'] + str(value['position'])).lower())
                temp[sleepervalue] = playerId
            if value['first_name'] == 'Jeff':
                sleepervalue = cleanPlayerIdString(str('jeffery' + value['last_name'] + str(value['position'])).lower())
                temp[sleepervalue] = playerId
            if value['last_name'] == 'Pacheco':
                sleepervalue = cleanPlayerIdString(str('isiah' + value['last_name'] + str(value['position'])).lower())
                temp[sleepervalue] = playerId
    return temp

def scrape_ktc(scrape_redraft=False):
    # universal vars
    URL = "https://keeptradecut.com/dynasty-rankings?page={0}&filters=QB|WR|RB|TE|RDP&format={1}"
    REDRAFT_URL = "https://keeptradecut.com/fantasy-rankings?page={0}&filters=QB|WR|RB|TE|RDP&format={1}"
    players_dict = {}

    def parse_player_elements(elements, format, is_redraft):
        # format == 1 -> KTC's 1QB market, format == 0 -> KTC's Superflex market.
        # Route each scrape into its own bucket instead of clobbering the 1QB
        # fields on every pass, so 1QB and Superflex values both survive.
        is_superflex = format == 0

        if is_redraft:
            position_rank_key = "SFRdrftPosition Rank" if is_superflex else "RdrftPosition Rank"
            value_key = "SFRdrftValue" if is_superflex else "RdrftValue"
        else:
            position_rank_key = "SFPosition Rank" if is_superflex else "Position Rank"
            value_key = "SFValue" if is_superflex else "Value"

        for player_element in elements:
            player_name_element = player_element.find(class_="player-name")
            player_position_element = player_element.find(class_="position")
            player_value_element = player_element.find(class_="value")
            player_age_element = player_element.find(class_="position hidden-xs")

            player_name = player_name_element.get_text(strip=True)
            team_suffix = (player_name[-3:] if player_name[-3:] == 'RFA' else player_name[-4:] if player_name[-4] == 'R' else player_name[-2:] if player_name[-2:] == 'FA' else player_name[-3:] if player_name[-3:].isupper() else "")

            player_name = player_name.replace(team_suffix, "").strip()
            player_position_rank = player_position_element.get_text(strip=True)
            player_value = player_value_element.get_text(strip=True)
            player_value = int(player_value)
            player_position = player_position_rank[:2]

            if player_age_element:
                player_age_text = player_age_element.get_text(strip=True)
                try:
                    player_age = float(player_age_text[:4]) if player_age_text else 0
                except ValueError:
                    player_age = 0
            else:
                player_age = 0

            if team_suffix[0] == 'R':
                player_team = team_suffix[1:]
                player_rookie = "Yes"
            else:
                player_team = team_suffix
                player_rookie = "No"

            player_id = cleanPlayerIdString(f"{player_name}{player_position}")
            sleeper_id = sleeperIdMapper.get(player_id, None)

            if player_id not in players_dict:
                players_dict[player_id] = {
                    "Player Name": player_name,
                    "Position Rank": None,
                    "Position": player_position,
                    "Team": player_team,
                    "Value": 0,
                    "Age": player_age,
                    "Rookie": player_rookie,
                    "SFPosition Rank": None,
                    "SFValue": 0,
                    "RdrftPosition Rank": None,
                    "RdrftValue": 0,
                    "SFRdrftPosition Rank": None,
                    "SFRdrftValue": 0,
                    "Sleeper ID": sleeper_id
                }

            players_dict[player_id][position_rank_key] = player_position_rank
            players_dict[player_id][value_key] = player_value

    for format in [1, 0]:
        if format == 1:
            for page in tqdm(range(10), desc="Linking to keeptradecut.com's 1QB rankings...", unit="page"):
                page = requests.get(URL.format(page, format))
                soup = BeautifulSoup(page.content, "html.parser")
                player_elements = soup.find_all(class_="onePlayer")
                parse_player_elements(player_elements, format, False)
        else:
            for page in tqdm(range(10), desc="Linking to keeptradecut.com's Superflex rankings...", unit="page"):
                page = requests.get(URL.format(page, format))
                soup = BeautifulSoup(page.content, "html.parser")
                player_elements = soup.find_all(class_="onePlayer")
                parse_player_elements(player_elements, format, False)

    if scrape_redraft:
        for format in [1, 0]:
            if format == 1:
                for page in tqdm(range(10), desc="Linking to keeptradecut.com's 1QB redraft rankings...", unit="page"):
                    page = requests.get(REDRAFT_URL.format(page, format))
                    soup = BeautifulSoup(page.content, "html.parser")
                    player_elements = soup.find_all(class_="onePlayer")
                    parse_player_elements(player_elements, format, True)
            else:
                for page in tqdm(range(10), desc="Linking to keeptradecut.com's Superflex redraft rankings...", unit="page"):
                    page = requests.get(REDRAFT_URL.format(page, format))
                    soup = BeautifulSoup(page.content, "html.parser")
                    player_elements = soup.find_all(class_="onePlayer")
                    parse_player_elements(player_elements, format, True)

    return list(players_dict.values())

# Write the data to MongoDB. This is a full refresh, not an incremental
# update: insert_many() alone would pile up a fresh set of documents (each
# with a new _id) on top of whatever is already there, leaving stale
# duplicates that the app's findOne() lookups could return instead of the
# new values. Clear the collection first so each run replaces the prior
# snapshot cleanly.
def write_to_mongodb(players_data):
    password = os.environ.get("MONGO_PASSWORD", "kabofahad123")
    uri = f"mongodb+srv://fantasypulseff:{password}@fantasypulsecluster.wj4o9kr.mongodb.net/?retryWrites=true&w=majority"
    client = MongoClient(uri, tlsCAFile=certifi.where())
    db = client['fantasypulse']
    collection = db['playersValues']
    collection.delete_many({})
    collection.insert_many(players_data)


if __name__ == "__main__":
    # Create dict of sleeper ids and name ids
    sleeperIdMapper = getSleeperData()

    # Get all players
    players = scrape_ktc(scrape_redraft=True)

    # Write the data to a JSON file (kept alongside the script for
    # inspection/debugging; it is not the source of truth, MongoDB is)
    with open(OUTPUT_PATH, 'w') as file:
        json.dump(players, file, indent=4)

    print(f"Retrieved information for {len(players)} players and saved to {OUTPUT_PATH}")

    with open(OUTPUT_PATH, 'r') as file:
        players_data = json.load(file)

    write_to_mongodb(players_data)
    print("Data written to MongoDB successfully.")
