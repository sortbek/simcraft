use actix_web::HttpResponse;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::share::is_share_id;
use crate::simc_directives::{has_substitution, is_blocked_rerun_token, simc_tokens};

/// A create-request body plus its raw JSON, kept on the job so a shared result can be re-run.
pub(super) struct ClientRequest<T> {
    pub req: T,
    pub raw: String,
    pub rerun_of: Option<String>,
}

/// How a string reaches SimC, which decides what its first line may hold.
#[derive(Clone, Copy, PartialEq)]
enum Text {
    /// Raw SimC text: every line is parsed as SimC.
    Simc,
    /// Emitted after the backend's own `key=`, so its first token is a value.
    Value,
    /// Display-only (item and build names): spaces allowed, but no extra lines.
    Display,
}

const SIMC_TEXT_KEYS: &[&str] = &[
    "simc_input",
    "custom_apl",
    "simc_header",
    "simc_base_player",
    "simc_raid_actors",
    "simc_post_combos",
    "simc_footer",
];
const DISPLAY_KEYS: &[&str] = &["name", "encounter", "instance_name", "source_name"];

fn text_kind(key: Option<&str>) -> Text {
    match key {
        Some(k) if SIMC_TEXT_KEYS.contains(&k) => Text::Simc,
        Some(k) if DISPLAY_KEYS.contains(&k) => Text::Display,
        _ => Text::Value,
    }
}

fn is_blocked_line(line: &str, kind: Text) -> bool {
    if has_substitution(line) {
        return true;
    }
    simc_tokens(line)
        .iter()
        .enumerate()
        .any(|(i, tok)| match kind {
            Text::Simc => is_blocked_rerun_token(tok, true),
            Text::Value if i == 0 => tok.contains('=') && is_blocked_rerun_token(tok, true),
            Text::Value => is_blocked_rerun_token(tok, true),
            Text::Display => tok.contains('=') && is_blocked_rerun_token(tok, true),
        })
}

fn sanitize_string(s: &str, kind: Text) -> Option<String> {
    let line_kind = |i: usize| if i == 0 { kind } else { Text::Simc };
    if !s
        .lines()
        .enumerate()
        .any(|(i, l)| is_blocked_line(l, line_kind(i)))
    {
        return None;
    }
    Some(
        s.lines()
            .enumerate()
            .filter(|(i, l)| !is_blocked_line(l, line_kind(*i)))
            .map(|(_, l)| l)
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

const CONSUMABLE_KEYS: &[&str] = &["food", "flask", "potion", "augmentation", "weapon_rune"];
/// Maps whose keys are emitted verbatim as `key=value` lines.
const EMITTED_KEY_MAPS: &[&str] = &["consumables", "raid_buffs", "expansion_options"];

fn is_blocked_key(key: &str, parent: Option<&str>) -> bool {
    if key.contains(['\n', '\r']) {
        return true;
    }
    if parent.is_some_and(|p| EMITTED_KEY_MAPS.contains(&p)) {
        return is_blocked_line(&format!("{key}=1"), Text::Simc);
    }
    is_blocked_line(key, Text::Display)
}

/// A shared result's request comes from an anonymous uploader; strip directives
/// that would write files or otherwise touch the viewer's machine.
fn sanitize_rerun(v: &mut Value) {
    sanitize_at(v, None);
}

fn sanitize_at(v: &mut Value, key: Option<&str>) {
    match v {
        Value::String(s) => {
            if let Some(clean) = sanitize_string(s, text_kind(key)) {
                *s = clean;
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| sanitize_at(x, key)),
        Value::Object(o) => {
            o.retain(|k, _| !is_blocked_key(k, key));
            if key == Some("consumables") {
                o.retain(|k, _| CONSUMABLE_KEYS.contains(&k.as_str()));
            }
            for (k, x) in o.iter_mut() {
                sanitize_at(x, Some(k));
            }
        }
        _ => {}
    }
}

/// The re-run sanitizer for a shared request loaded into the editor, which later
/// submits it as an ordinary (unsanitized) sim.
pub(super) fn sanitize_shared_request(mut body: Value) -> Value {
    sanitize_rerun(&mut body);
    body
}

pub(super) fn parse_client_request<T: DeserializeOwned>(
    mut body: Value,
) -> Result<ClientRequest<T>, HttpResponse> {
    let rerun_of = body
        .as_object_mut()
        .and_then(|o| o.remove("rerun_of"))
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|s| is_share_id(s));
    if rerun_of.is_some() {
        sanitize_rerun(&mut body);
    }
    let raw = body.to_string();
    if let (Some(_), Some(o)) = (&rerun_of, body.as_object_mut()) {
        o.insert("untrusted".into(), json!(true));
    }
    let req = serde_json::from_value(body).map_err(|e| {
        HttpResponse::BadRequest().json(json!({ "detail": format!("Invalid request: {e}") }))
    })?;
    Ok(ClientRequest { req, raw, rerun_of })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;

    #[derive(Deserialize)]
    struct Req {
        simc_input: String,
    }

    #[test]
    fn strips_rerun_of_and_keeps_raw_body() {
        let c = parse_client_request::<Req>(json!({"simc_input": "x=1", "rerun_of": "AbCdEfGhIj"}))
            .ok()
            .unwrap();
        assert_eq!(c.req.simc_input, "x=1");
        assert_eq!(c.rerun_of.as_deref(), Some("AbCdEfGhIj"));
        assert_eq!(c.raw, r#"{"simc_input":"x=1"}"#);
    }

    #[test]
    fn ignores_malformed_rerun_of() {
        let c = parse_client_request::<Req>(json!({"simc_input": "x", "rerun_of": "../../etc"}))
            .ok()
            .unwrap();
        assert!(c.rerun_of.is_none());
    }

    #[derive(Deserialize)]
    struct Nested {
        simc_input: String,
        expert: Expert,
    }
    #[derive(Deserialize)]
    struct Expert {
        custom_apl: String,
    }

    #[test]
    fn rerun_strips_blocked_directives_everywhere() {
        let c = parse_client_request::<Nested>(json!({
            "simc_input": "warrior=\"x\"\noutput=C:\\x.cmd\n  SAVE=foo\njson2=a\niterations=10\nactions=a json=b",
            "expert": {"custom_apl": "actions=x\nhtml=y\ndps_plot_stat=z\nlog+=q"},
            "rerun_of": "AbCdEfGhIj"
        }))
        .ok()
        .unwrap();
        assert_eq!(c.req.simc_input, "warrior=\"x\"\niterations=10");
        assert_eq!(c.req.expert.custom_apl, "actions=x");
        assert!(!c.raw.contains("output="));
        assert!(!c.raw.contains("json2="));
    }

    fn rerun_input(simc_input: &str) -> String {
        parse_client_request::<Req>(json!({"simc_input": simc_input, "rerun_of": "AbCdEfGhIj"}))
            .ok()
            .unwrap()
            .req
            .simc_input
    }

    #[test]
    fn rerun_strips_quoted_keys() {
        let input = "iterations=1\n\"output\"=C:\\a\nou\"tp\"ut=C:\\b\nsave_actions\"\"=C:\\c\n\" output\"=C:\\d\noutput\"\"+=C:\\e";
        assert_eq!(rerun_input(input), "iterations=1");
    }

    #[test]
    fn rerun_strips_prefix_families() {
        let input = "iterations=1\nsave_actions=a\nsave_talents=a\nsave_full_profile=a\n\
            save_profile_with_actions=a\nsave_raid_summary=1\nsave_prefix=a\nsave_suffix=a\n\
            json3=a\nhtml_x=a\noutput_file=a\nlog_spell_id=1\nreport_details=1\nxml=a\n\
            debug_scale_factors=1\nspell_query=a\nreforge_plot_output_file=a\n\
            input=C:\\x.simc\n\"input\"=C:\\x.simc\ninput_x=a";
        assert_eq!(rerun_input(input), "iterations=1");
    }

    #[test]
    fn rerun_strips_blocked_options_inside_profilesets() {
        let input =
            "iterations=1\nprofileset.\"p\"+=output=C:\\a\nprofileset.\"p\"+=ou\"tp\"ut=C:\\b\n\
            profileset.\"p\"+=\"save_actions=C:\\c\"\nprofileset.\"p\"+=head=,id=1";
        assert_eq!(
            rerun_input(input),
            "iterations=1\nprofileset.\"p\"+=head=,id=1"
        );
    }

    #[derive(Deserialize)]
    struct WithMaps {
        consumables: std::collections::HashMap<String, String>,
        raid_buffs: std::collections::HashMap<String, u8>,
    }

    #[test]
    fn rerun_drops_blocked_or_unknown_object_keys() {
        let c = parse_client_request::<WithMaps>(json!({
            "consumables": {
                "food": "feast", "flask": "f", "potion": "p", "augmentation": "a", "weapon_rune": "r",
                "output": "C:\\x", "food\njson=C:\\y": "z", "bogus": "q"
            },
            "raid_buffs": {"bloodlust": 1, "x\noutput": 1, "\"save\"": 1, "a json2": 1},
            "rerun_of": "AbCdEfGhIj"
        }))
        .ok()
        .unwrap();
        let mut cons: Vec<_> = c.req.consumables.keys().cloned().collect();
        cons.sort();
        assert_eq!(
            cons,
            ["augmentation", "flask", "food", "potion", "weapon_rune"]
        );
        let buffs: Vec<_> = c.req.raid_buffs.keys().cloned().collect();
        assert_eq!(buffs, ["bloodlust"]);
        assert!(!c.raw.contains("output"));
    }

    fn bundled_simc() -> Option<std::path::PathBuf> {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/simc");
        std::fs::read_dir(root).ok()?.flatten().find_map(|d| {
            ["simc.exe", "simc"]
                .iter()
                .map(|b| d.path().join(b))
                .find(|p| p.is_file())
        })
    }

    /// Runs one request body through the real input builder and SimC; returns the files SimC left behind.
    fn simc_writes(simc: &std::path::Path, body: Value) -> Vec<String> {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().display().to_string();
        let body: Value =
            serde_json::from_str(&body.to_string().replace("{D}", &d.replace('\\', "\\\\")))
                .unwrap();
        let c = parse_client_request::<crate::server::types::SimRequest>(body)
            .ok()
            .unwrap();
        let input = crate::simc_runner::build_simc_input_from_options(
            &c.req.simc_input,
            &c.req.options.to_json(),
        );
        std::fs::write(dir.path().join("profile.simc"), input).unwrap();
        // Target of the `input=` bypass; an `input=` that survives writes Raid_Summary.simc.
        std::fs::write(dir.path().join("inc.simc"), "save_raid_summary=1\n").unwrap();
        let out = std::process::Command::new(simc)
            .current_dir(dir.path())
            .args(["profile.simc", "threads=1"])
            .output()
            .unwrap();
        // A failed run writes nothing, which would pass vacuously.
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stdout)
        );
        let mut files: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|f| f != "profile.simc" && f != "inc.simc")
            .collect();
        files.sort();
        files
    }

    #[test]
    fn bundled_simc_writes_no_files_on_a_sanitized_rerun() {
        let Some(simc) = bundled_simc() else {
            eprintln!("skipped: no bundled simc under backend/resources/simc");
            return;
        };
        let fixture = include_str!("../../tests/fixtures/roster_simc_paste.txt");
        let actor: String = fixture
            .lines()
            .skip(1)
            .take(24)
            .collect::<Vec<_>>()
            .join("\n");
        let bypasses = [
            r#""output"={D}\a.txt"#,
            r#"save_actions={D}\b.simc"#,
            r#"save_talents={D}\c.simc"#,
            r#"max_time=10 "html"={D}\e.html"#,
            r#"profileset."p"+=ou"tp"ut={D}\f.txt"#,
            r#""input"={D}\inc.simc"#,
        ];
        let body = |rerun: bool| {
            let mut b = json!({
                "simc_input": format!("{actor}\n{}", bypasses.join("\n")),
                "iterations": 1,
                "consumables": {"json2": r"{D}\g.json", "x=1\nsave_gear": r"{D}\h.simc"},
            });
            if rerun {
                b["rerun_of"] = json!("AbCdEfGhIj");
            }
            b
        };
        let raw = simc_writes(&simc, body(false));
        assert_eq!(
            raw,
            [
                "Raid_Summary.simc",
                "a.txt",
                "b.simc",
                "c.simc",
                "e.html",
                "f.txt",
                "g.json",
                "h.simc"
            ],
            "unsanitized bypasses should write files, proving the check is live"
        );
        assert_eq!(simc_writes(&simc, body(true)), Vec::<String>::new());
    }

    /// Each bypass is checked alone, so every one is shown to be live unsanitized.
    #[test]
    fn bundled_simc_runs_no_include_or_substitution_on_a_sanitized_rerun() {
        let Some(simc) = bundled_simc() else {
            eprintln!("skipped: no bundled simc under backend/resources/simc");
            return;
        };
        let fixture = include_str!("../../tests/fixtures/roster_simc_paste.txt");
        let actor: String = fixture
            .lines()
            .skip(1)
            .take(24)
            .collect::<Vec<_>>()
            .join("\n");
        let bypasses = [
            // `$(var)` assembles a blocked key from parts
            "$(t)=t\nou$(t)put={D}\\i.txt",
            // a token without `=` is opened as an input file
            "{D}\\inc.simc",
            "max_time=300 {D}\\inc.simc",
            "\"{D}\\inc.simc\"",
            "$(f)={D}\\inc\n$(f).simc",
        ];
        for bypass in bypasses {
            let body = |rerun: bool| {
                let mut b = json!({"simc_input": format!("{actor}\n{bypass}"), "iterations": 1});
                if rerun {
                    b["rerun_of"] = json!("AbCdEfGhIj");
                }
                b
            };
            assert!(
                !simc_writes(&simc, body(false)).is_empty(),
                "not live: {bypass}"
            );
            assert_eq!(
                simc_writes(&simc, body(true)),
                Vec::<String>::new(),
                "{bypass}"
            );
        }
    }

    /// The backend copies the actor's name into an unquoted `name=` line, so a
    /// quoted name hiding a path must not come out as its own token.
    #[test]
    fn bundled_simc_runs_no_include_hidden_in_the_actor_name() {
        let Some(simc) = bundled_simc() else {
            eprintln!("skipped: no bundled simc under backend/resources/simc");
            return;
        };
        let fixture = include_str!("../../tests/fixtures/roster_simc_paste.txt");
        let actor: String = fixture
            .lines()
            .skip(1)
            .take(24)
            .collect::<Vec<_>>()
            .join("\n");
        for line in [r#"evoker="x {D}\inc.simc""#, r#"# x="a {D}\inc.simc""#] {
            let body = json!({
                "simc_input": format!("{line}\n{actor}"),
                "iterations": 1,
                "rerun_of": "AbCdEfGhIj",
            });
            assert_eq!(simc_writes(&simc, body), Vec::<String>::new(), "{line}");
        }
    }

    #[test]
    fn rerun_keeps_comments_values_and_display_names() {
        let v = sanitize_shared_request(json!({
            "simc_input": "# Saved Loadout: My Build\nwarrior=\"Some Name\"\nhead=,id=1 # note",
            "fight_style": "Patchwerk",
            "selected_items": {"head": ["212:1,2:bags:head"]},
            "talent_builds": [{"name": "Raid Build", "talent_string": "ABC"}],
            "drop_items": [{"name": "Graft of the Domanaar", "encounter": "Lady Vashj"}],
        }));
        assert_eq!(
            v["simc_input"],
            "# Saved Loadout: My Build\nwarrior=\"Some Name\"\nhead=,id=1 # note"
        );
        assert_eq!(v["fight_style"], "Patchwerk");
        assert_eq!(v["selected_items"]["head"][0], "212:1,2:bags:head");
        assert_eq!(v["talent_builds"][0]["name"], "Raid Build");
        assert_eq!(v["drop_items"][0]["name"], "Graft of the Domanaar");
    }

    #[test]
    fn rerun_strips_includes_hidden_in_values() {
        let v = sanitize_shared_request(json!({
            "talents": "ABC C:\\x.simc",
            "fight_style": "Patchwerk\nC:\\x.simc",
            "talent_builds": [{"name": "A\ninc.simc", "talent_string": "$(x)"}],
            "raid_buffs": {"bloodlust": 1, "C:\\x.simc y": 1},
        }));
        assert_eq!(v["talents"], "");
        assert_eq!(v["fight_style"], "Patchwerk");
        assert_eq!(v["talent_builds"][0]["name"], "A");
        assert_eq!(v["talent_builds"][0]["talent_string"], "");
        assert_eq!(v["raid_buffs"], json!({"bloodlust": 1}));
    }

    #[test]
    fn shared_request_for_the_editor_is_sanitized() {
        let v = sanitize_shared_request(json!({
            "simc_input": "warrior=\"x\"\noutput=C:\\x.cmd",
            "custom_apl": "actions=a\nsave_actions=b",
            "consumables": {"flask": "f", "json2": "C:\\y"}
        }));
        assert_eq!(v["simc_input"], "warrior=\"x\"");
        assert_eq!(v["custom_apl"], "actions=a");
        assert_eq!(v["consumables"], json!({"flask": "f"}));
    }

    #[test]
    fn non_rerun_body_is_untouched() {
        let input = "output=C:\\x.cmd\nsave=a";
        let c = parse_client_request::<Req>(json!({ "simc_input": input }))
            .ok()
            .unwrap();
        assert_eq!(c.req.simc_input, input);
    }

    #[test]
    fn bad_body_is_400() {
        let r = parse_client_request::<Req>(json!({"nope": 1}))
            .err()
            .unwrap();
        assert_eq!(r.status(), actix_web::http::StatusCode::BAD_REQUEST);
    }
}
