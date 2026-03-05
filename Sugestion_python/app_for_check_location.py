from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
from typing import List, Dict, Set

from building_location_matcher import BuildingLocationMatcher
from ground_location_matcher import GroundLocationMatcher

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

GROUND_LOCATIONS = []
BUILDING_FLOORS = {}


def load_location_data():
    global GROUND_LOCATIONS, BUILDING_FLOORS

    data_folder = "data"

    with open(os.path.join(data_folder, "map.json"), "r") as f:
        GROUND_LOCATIONS = json.load(f)

    BUILDING_FLOORS = {}
    for f_name in os.listdir(data_folder):
        if f_name.endswith(".json") and f_name != "map.json":
            building = f_name.replace(".json", "")
            with open(os.path.join(data_folder, f_name), "r") as f:
                BUILDING_FLOORS[building] = json.load(f)


load_location_data()


class LocationMatcher:
    def __init__(self, ground_data: List[Dict], building_data: Dict):
        self.ground_data = ground_data
        self.building_data = building_data

        self.ground_lookup = {loc["actual_location"]: loc for loc in ground_data}
        self.building_lookup = self._build_building_lookup()

        self.ground_matcher = GroundLocationMatcher(self.ground_lookup)
        self.building_matcher = BuildingLocationMatcher(self.building_lookup, building_data)
        self.entrance_to_building = self._build_entrance_mapping()

    def _build_entrance_mapping(self):
        mapping = {}
        for loc in self.ground_data:
            name = loc["actual_location"]
            if "_entrance" in name:
                b = name.replace("_entrance", "")
                if b in self.building_data:
                    mapping[name] = b
        return mapping

    def _build_building_lookup(self):
        lookup = {}
        for building, floors in self.building_data.items():
            for floor in floors:
                f_id = str(floor.get("floor_id"))
                for hall in floor.get("hall_list", []):
                    hall_name = hall["actual_location"]
                    lookup[hall_name] = {
                        "building": building,
                        "floor_id": f_id,
                        "directions": hall.get("directions"),
                    }
        return lookup

    def get_matched_items(self, owner: Dict):
        owner_loc = owner.get("owner_location")
        floor = owner.get("floor_id")
        hall = owner.get("hall_name")
        stage = owner.get("owner_location_confidence_stage", 1)
        category_data = owner.get("categary_data", [])

        if hall:
            matched = self.building_matcher.match_with_hall(owner_loc, floor, hall, stage)
            loc_type = "building_with_hall"

        elif floor:
            matched = self.building_matcher.match_with_floor(owner_loc, floor, stage)
            loc_type = "building_with_floor"

        elif self._is_building_location(owner_loc):
            matched = self.building_matcher.match_building_only(owner_loc, stage, self.ground_lookup,
                                                                self.ground_matcher.get_adjacent)
            loc_type = "building_only"

        else:
            matched = self.ground_matcher.match(owner_loc, stage)
            loc_type = "ground_location"

        matched_ids = self._filter_items(category_data, owner_loc, floor, hall, stage, matched)

        if not matched_ids:
            matched = set()
            matched_ids = self._filter_items(category_data, owner_loc, floor, hall, 3, matched)

        return {
            "location_type": loc_type,
            "matched_locations": sorted(list(matched)),
            "matched_ids": matched_ids
        }

    def _is_building_location(self, location: str):
        if location in self.ground_lookup:
            return False
        if location in self.building_lookup:
            return False
        return location in self.building_data

    def _filter_items(self, items, owner_loc, owner_floor, owner_hall, stage, matched_locations):
        matched_ids = []
        actual_building = self.entrance_to_building.get(owner_loc, owner_loc)
        is_entrance = owner_loc in self.entrance_to_building

        for item in items:
            for found in item.get("found_location", []):
                loc = found.get("location")
                floor = found.get("floor_id")
                hall = found.get("hall_name")
                ok = False

                if owner_hall:
                    if loc == actual_building and hall in matched_locations:
                        ok = True

                elif owner_floor is not None:
                    if stage == 1:
                        ok = loc == actual_building and floor == owner_floor
                    elif stage == 2:
                        ok = loc == actual_building and floor in [owner_floor, owner_floor + 1, owner_floor - 1]
                    elif stage == 3:
                        ok = loc == actual_building

                else:
                    if is_entrance and loc == actual_building and (floor or hall):
                        continue
                    if loc in matched_locations:
                        ok = True
                    elif hall in matched_locations and self.building_lookup.get(hall, {}).get("building") == loc:
                        ok = True

                if ok:
                    matched_ids.append(item["id"])
                    break

        return matched_ids


@app.route("/api/find-items", methods=["POST"])
def find_items():
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    print("Received data:", data.get("found_location.location", []))
    required = ["owner_id", "categary_name", "categary_data",
                "owner_location", "owner_location_confidence_stage"]

    for f in required:
        if f not in data:
            return jsonify({"success": False, "error": f"Missing field: {f}"}), 400

    stage = data.get("owner_location_confidence_stage")
    if stage not in [1, 2, 3,4]:
        return jsonify({"success": False, "error": "Stage must be 1–3"}), 400
    
    if stage == 4:
        all_ids = []
        all_locations = set()

        for item in data.get("categary_data", []):
            all_ids.append(item["id"])

            for found in item.get("found_location", []):
                loc = found.get("location")
                if loc:
                    all_locations.add(loc)

        return jsonify({
            "success": True,
            "location_match": False,
            "matched_locations": list(all_locations),
            "matched_item_ids": all_ids
        }), 200

    try:
        matcher = LocationMatcher(GROUND_LOCATIONS, BUILDING_FLOORS)
        result = matcher.get_matched_items(data)

        return jsonify({
            "success": True,
              "location_match": True,
            "matched_locations": result["matched_locations"],
            "matched_item_ids": result["matched_ids"]
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5001, host='0.0.0.0')
