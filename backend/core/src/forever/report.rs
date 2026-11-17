//! The parts of a Forever result read from the engine's first-fight log and from the rotation it
//! ran: a cast timeline with aura bars and the mana curve, and the rotation as readable lines.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Map, Value};

use super::data::ForeverData;

/// proto.OtherAction numbers the log writes; the result itself spells these names out.
fn other_action(number: u64) -> &'static str {
    match number {
        2 => "Mana regen",
        3 => "Attack",
        4 => "Shoot",
        5 => "Energy regen",
        6 => "Focus regen",
        10 => "Mana gain",
        11 => "Rage gain",
        17 => "Potion",
        _ => "",
    }
}

static LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\[(-?[\d.]+)\] \[([^\]]+)\] (.*)$").unwrap());
static ID: Lazy<Regex> = Lazy::new(|| Regex::new(r"\{(SpellID|OtherID|ItemID): (\d+)").unwrap());
static MANA: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"mana from .*\(-?[\d.]+ --> (-?[\d.]+)\) of").unwrap());

/// (name, icon) of an id as the log writes it, or None for one worth no row.
fn named(text: &str, data: &ForeverData) -> Option<(String, Option<String>)> {
    let id = ID.captures(text)?;
    let number: u64 = id[2].parse().ok()?;
    match &id[1] {
        "SpellID" => {
            let name = data.spells.get(&(number as u32))?.clone();
            Some((name, data.spell_icons.get(&(number as u32)).cloned()))
        }
        "ItemID" => {
            let item = data.items.get(&(number as u32))?;
            Some((
                item.name.clone(),
                Some(item.icon.clone()).filter(|i| !i.is_empty()),
            ))
        }
        _ => {
            let name = other_action(number);
            let icon = match name {
                "Shoot" => Some("ability_marksmanship".to_string()),
                "Attack" => Some("ability_meleedamage".to_string()),
                _ => None,
            };
            (!name.is_empty()).then(|| (name.to_string(), icon))
        }
    }
}

struct AuraRow {
    name: String,
    icon: Option<String>,
    on: &'static str,
    spans: Vec<[f64; 2]>,
    open: Option<f64>,
}

/// The logged fight: every cast with its time, when each aura was up on the player and on the
/// target, and the mana after each change. Times are seconds from the pull; the prepull is negative.
pub fn timeline(logs: &str, duration: f64, data: &ForeverData) -> Value {
    let mut casts: Vec<Value> = Vec::new();
    let mut auras: Vec<AuraRow> = Vec::new();
    let mut mana: Vec<[f64; 2]> = Vec::new();
    for line in logs.lines() {
        let Some(parts) = LINE.captures(line) else {
            continue;
        };
        let Ok(time) = parts[1].parse::<f64>() else {
            continue;
        };
        let (unit, text) = (&parts[2], &parts[3]);
        let is_target = unit.starts_with("Target");
        // "<player> - <pet>" is a pet; a bare unit is the player.
        let pet = unit.split_once(" - ").map(|(_, pet)| pet);
        if let Some(cast) = text.strip_prefix("Casting ") {
            if let Some((name, icon)) = named(cast, data) {
                casts.push(
                    json!({ "t": time, "name": name, "icon": icon, "owner": pet.unwrap_or("") }),
                );
            }
        } else if let Some(rest) = text
            .strip_prefix("Aura gained: ")
            .or_else(|| text.strip_prefix("Aura faded: "))
        {
            if pet.is_some() {
                continue;
            }
            let Some((name, icon)) = named(rest, data) else {
                continue;
            };
            let on = if is_target { "target" } else { "player" };
            let row = match auras.iter().position(|a| a.name == name && a.on == on) {
                Some(i) => &mut auras[i],
                None => {
                    auras.push(AuraRow {
                        name,
                        icon,
                        on,
                        spans: Vec::new(),
                        open: None,
                    });
                    auras.last_mut().expect("just pushed")
                }
            };
            if text.starts_with("Aura gained") {
                row.open.get_or_insert(time.max(0.0));
            } else if let Some(start) = row.open.take() {
                row.spans.push([start, time.max(0.0)]);
            }
        } else if pet.is_none() && !is_target {
            if let Some(after) = MANA.captures(text).and_then(|m| m[1].parse::<f64>().ok()) {
                // One point a moment is enough for the curve.
                match mana.last_mut() {
                    Some(last) if (last[0] - time).abs() < 0.25 => last[1] = after,
                    _ => mana.push([time, after]),
                }
            }
        }
    }
    let auras: Vec<Value> = auras
        .into_iter()
        .map(|mut row| {
            if let Some(start) = row.open.take() {
                row.spans.push([start, duration]);
            }
            json!({ "name": row.name, "icon": row.icon, "on": row.on, "spans": row.spans })
        })
        .filter(|row| !row["spans"].as_array().is_some_and(Vec::is_empty))
        .collect();
    json!({ "duration": duration, "casts": casts, "auras": auras, "mana": mana })
}

fn spell_name(id: &Value, data: &ForeverData) -> String {
    if let Some(spell) = id.get("spellId").and_then(Value::as_u64) {
        return data
            .spells
            .get(&(spell as u32))
            .cloned()
            .unwrap_or_else(|| format!("spell {spell}"));
    }
    if let Some(item) = id.get("itemId").and_then(Value::as_u64) {
        return data
            .items
            .get(&(item as u32))
            .map(|i| i.name.clone())
            .unwrap_or_else(|| format!("item {item}"));
    }
    id.get("otherId")
        .and_then(Value::as_str)
        .map(|o| o.trim_start_matches("OtherAction").to_string())
        .unwrap_or_else(|| "?".into())
}

/// `spellTimeToReady` to "spell time to ready".
fn words(key: &str) -> String {
    let mut out = String::new();
    for c in key.chars() {
        if c.is_uppercase() {
            out.push(' ');
        }
        out.extend(c.to_lowercase());
    }
    out
}

/// The spell an APL node names, wherever its kind keeps it.
fn node_spell(node: &Value, data: &ForeverData) -> Option<String> {
    ["spellId", "auraId", "sourceUnit"]
        .iter()
        .find_map(|key| {
            node.get(*key)
                .filter(|id| id.get("spellId").is_some() || id.get("itemId").is_some())
        })
        .map(|id| spell_name(id, data))
}

/// A value of the rotation language as words: a constant, a comparison, or the reading's name.
fn describe_value(value: &Value, data: &ForeverData) -> String {
    let Some((kind, node)) = value.as_object().and_then(|o| o.iter().next()) else {
        return "?".into();
    };
    let side = |key: &str| describe_value(&node[key], data);
    let list = |joiner: &str| {
        node["vals"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|v| describe_value(v, data))
            .collect::<Vec<_>>()
            .join(joiner)
    };
    match kind.as_str() {
        "const" => node["val"].as_str().unwrap_or("?").to_string(),
        "cmp" => {
            let op = match node["op"].as_str().unwrap_or("") {
                "OpEq" => "=",
                "OpNe" => "≠",
                "OpLt" => "<",
                "OpLe" => "≤",
                "OpGt" => ">",
                "OpGe" => "≥",
                _ => "?",
            };
            format!("{} {op} {}", side("lhs"), side("rhs"))
        }
        "and" => list(" and "),
        "or" => format!("({})", list(" or ")),
        "not" => format!("not {}", side("val")),
        "sequenceIsComplete" | "sequenceIsReady" => format!(
            "sequence \"{}\" {}",
            node["sequenceName"].as_str().unwrap_or(""),
            if kind == "sequenceIsComplete" {
                "is complete"
            } else {
                "is ready"
            }
        ),
        _ => match node_spell(node, data) {
            Some(spell) => format!("{} of {spell}", words(kind)),
            None => words(kind),
        },
    }
}

/// One action of the rotation as words, without its condition.
fn describe_action(action: &Map<String, Value>, data: &ForeverData) -> String {
    let Some((kind, node)) = action.iter().find(|(key, _)| *key != "condition") else {
        return "?".into();
    };
    let casts = |key: &str| {
        node[key]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_object)
            .map(|step| describe_action(step, data))
            .collect::<Vec<_>>()
            .join(", then ")
    };
    match kind.as_str() {
        "castSpell" => format!("Cast {}", spell_name(&node["spellId"], data)),
        "castFriendlySpell" => format!("Cast {} on an ally", spell_name(&node["spellId"], data)),
        "channelSpell" => format!("Channel {}", spell_name(&node["spellId"], data)),
        "multidot" => format!(
            "Keep {} on every target",
            spell_name(&node["spellId"], data)
        ),
        "autocastOtherCooldowns" => "Use the other cooldowns as they come up".into(),
        "sequence" => format!(
            "Sequence \"{}\": {}",
            node["name"].as_str().unwrap_or(""),
            casts("actions")
        ),
        "strictSequence" => format!("In one go: {}", casts("actions")),
        "resetSequence" => format!(
            "Restart sequence \"{}\"",
            node["sequenceName"].as_str().unwrap_or("")
        ),
        "activateAura" => format!("Activate {}", spell_name(&node["auraId"], data)),
        "cancelAura" => format!("Cancel {}", spell_name(&node["auraId"], data)),
        "wait" => format!("Wait {}", describe_value(&node["duration"], data)),
        "waitUntil" => format!("Wait until {}", describe_value(&node["condition"], data)),
        "itemSwap" => "Swap items".into(),
        _ => {
            let mut text = words(kind);
            if let Some(first) = text.get_mut(..1) {
                first.make_ascii_uppercase();
            }
            match node_spell(node, data) {
                Some(spell) => format!("{text} {spell}"),
                None => text,
            }
        }
    }
}

/// The rotation as numbered lines: what is cast before the pull, then the priority list, each
/// line with its condition in words.
pub fn rotation(applied: &Value, data: &ForeverData) -> Value {
    let apl = &applied["rotation"];
    let prepull: Vec<Value> = apl["prepullActions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let action = p["action"].as_object()?;
            Some(json!({ "at": describe_value(&p["doAtValue"], data), "text": describe_action(action, data) }))
        })
        .collect();
    let lines: Vec<Value> = apl["priorityList"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|line| {
            let action = line["action"].as_object()?;
            let condition = action.get("condition").map(|c| describe_value(c, data));
            Some(json!({ "text": describe_action(action, data), "condition": condition }))
        })
        .collect();
    json!({ "id": applied["rotationId"], "prepull": prepull, "lines": lines })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> &'static ForeverData {
        crate::forever::test_data()
    }

    #[test]
    fn timeline_reads_casts_auras_and_mana() {
        let logs = "\
[-10.00] [Sylfrey (#1)] Casting {OtherID: 4} (Cost = 0.000, Cast Time = 0s)
[-10.00] [Sylfrey (#1)] Spent 50.000 mana from {OtherID: 4} (960.000 --> 910.000) of 960 total.
[0.00] [Target 1] Aura gained: {OtherID: 3, Tag: -1}
[1.00] [Sylfrey (#1) - Raptor] Casting {OtherID: 3} (Cost = 0.000)
[2.00] [Sylfrey (#1)] Aura gained: {OtherID: 4}
[5.50] [Sylfrey (#1)] Aura faded: {OtherID: 4}
[6.00] [Sylfrey (#1)] Gained 27.200 mana from {OtherID: 2, Tag: 2} (910.000 --> 937.200) of 960 total.
[7.00] [Sylfrey (#1)] No available actions!
[8.00] [Sylfrey (#1)] Casting {SpellID: 999999999} (Cost = 0.000)";
        let t = timeline(logs, 120.0, data());
        let casts = t["casts"].as_array().unwrap();
        assert_eq!(
            casts.len(),
            2,
            "a spell the bundle does not name is left out"
        );
        assert_eq!(
            (&casts[0]["name"], &casts[0]["t"], &casts[0]["owner"]),
            (&json!("Shoot"), &json!(-10.0), &json!(""))
        );
        assert_eq!(
            (&casts[1]["name"], &casts[1]["owner"]),
            (&json!("Attack"), &json!("Raptor"))
        );
        let auras = t["auras"].as_array().unwrap();
        assert_eq!(
            auras[0],
            json!({ "name": "Attack", "icon": "ability_meleedamage", "on": "target", "spans": [[0.0, 120.0]] })
        );
        assert_eq!(auras[1]["spans"], json!([[2.0, 5.5]]));
        assert_eq!(t["mana"], json!([[-10.0, 910.0], [6.0, 937.2]]));
    }

    #[test]
    fn rotation_reads_as_lines_with_conditions() {
        let applied = json!({ "rotationId": "hunter/dps/bm", "rotation": {
            "prepullActions": [{ "action": { "castSpell": { "spellId": { "otherId": "OtherActionShoot" } } }, "doAtValue": { "const": { "val": "-2.5s" } } }],
            "priorityList": [
                { "action": { "autocastOtherCooldowns": {} } },
                { "action": {
                    "condition": { "and": { "vals": [
                        { "cmp": { "op": "OpLt", "lhs": { "dotRemainingTime": { "spellId": { "otherId": "OtherActionAttack" } } }, "rhs": { "const": { "val": "1s" } } } },
                        { "cmp": { "op": "OpGe", "lhs": { "currentManaPercent": {} }, "rhs": { "const": { "val": "30%" } } } },
                    ] } },
                    "castSpell": { "spellId": { "otherId": "OtherActionShoot" } },
                } },
                { "action": { "condition": { "sequenceIsComplete": { "sequenceName": "hawks" } }, "resetSequence": { "sequenceName": "hawks" } } },
                { "action": { "sequence": { "name": "hawks", "actions": [
                    { "castSpell": { "spellId": { "otherId": "OtherActionShoot" } } },
                    { "castSpell": { "spellId": { "otherId": "OtherActionAttack" } } },
                ] } } },
            ],
        } });
        let r = rotation(&applied, data());
        assert_eq!(r["id"], "hunter/dps/bm");
        assert_eq!(
            r["prepull"],
            json!([{ "at": "-2.5s", "text": "Cast Shoot" }])
        );
        let lines = r["lines"].as_array().unwrap();
        assert_eq!(
            lines[0],
            json!({ "text": "Use the other cooldowns as they come up", "condition": null })
        );
        assert_eq!(lines[1]["text"], "Cast Shoot");
        assert_eq!(
            lines[1]["condition"],
            "dot remaining time < 1s and current mana percent ≥ 30%"
        );
        assert_eq!(
            lines[2],
            json!({ "text": "Restart sequence \"hawks\"", "condition": "sequence \"hawks\" is complete" })
        );
        assert_eq!(
            lines[3]["text"],
            "Sequence \"hawks\": Cast Shoot, then Cast Attack"
        );
    }
}
