//! CBOR -> [`AceValue`], for MDT2 export strings (WoW's
//! `C_EncodingUtil.SerializeCBOR`). Covers the subset a Lua table serializes
//! to: integers, floats, byte/text strings, arrays, maps, booleans and nil.
//! Arrays become tables with 1-based integer keys, as they were in Lua.

use super::ace::{AceTable, AceValue};

pub fn deserialize(data: &[u8]) -> Result<AceValue, String> {
    let mut pos = 0;
    let value = read_value(data, &mut pos)?;
    Ok(value)
}

fn take<'a>(data: &'a [u8], pos: &mut usize, n: usize) -> Result<&'a [u8], String> {
    let end = pos
        .checked_add(n)
        .filter(|&e| e <= data.len())
        .ok_or("CBOR payload is truncated")?;
    let bytes = &data[*pos..end];
    *pos = end;
    Ok(bytes)
}

/// The argument following an initial byte: the value itself below 24, else the
/// next 1, 2, 4 or 8 bytes big-endian.
fn read_arg(data: &[u8], pos: &mut usize, info: u8) -> Result<u64, String> {
    let n = match info {
        0..=23 => return Ok(info as u64),
        24 => 1,
        25 => 2,
        26 => 4,
        27 => 8,
        _ => return Err(format!("unsupported CBOR length encoding {info}")),
    };
    Ok(take(data, pos, n)?
        .iter()
        .fold(0u64, |acc, &b| (acc << 8) | b as u64))
}

fn read_value(data: &[u8], pos: &mut usize) -> Result<AceValue, String> {
    let initial = take(data, pos, 1)?[0];
    let (major, info) = (initial >> 5, initial & 0x1f);
    if major == 7 {
        return match info {
            20 => Ok(AceValue::Bool(false)),
            21 => Ok(AceValue::Bool(true)),
            22 | 23 => Ok(AceValue::Nil),
            25 => Ok(AceValue::Float(
                half_to_f64(read_arg(data, pos, 25)? as u16),
            )),
            26 => Ok(AceValue::Float(
                f32::from_bits(read_arg(data, pos, 26)? as u32) as f64,
            )),
            27 => Ok(AceValue::Float(f64::from_bits(read_arg(data, pos, 27)?))),
            _ => Err(format!("unsupported CBOR simple value {info}")),
        };
    }
    let arg = read_arg(data, pos, info)?;
    Ok(match major {
        0 => AceValue::Int(arg as i64),
        1 => AceValue::Int(-1 - arg as i64),
        2 | 3 => {
            AceValue::Str(String::from_utf8_lossy(take(data, pos, arg as usize)?).into_owned())
        }
        4 => {
            let mut table = AceTable::default();
            for i in 1..=arg as i64 {
                table.pairs.push((AceValue::Int(i), read_value(data, pos)?));
            }
            AceValue::Table(table)
        }
        5 => {
            let mut table = AceTable::default();
            for _ in 0..arg {
                let key = read_value(data, pos)?;
                table.pairs.push((key, read_value(data, pos)?));
            }
            AceValue::Table(table)
        }
        _ => return Err(format!("unsupported CBOR major type {major}")),
    })
}

fn half_to_f64(h: u16) -> f64 {
    let exp = (h >> 10) & 0x1f;
    let frac = (h & 0x3ff) as f64;
    let magnitude = match exp {
        0 => frac * 2f64.powi(-24),
        31 if frac == 0.0 => f64::INFINITY,
        31 => f64::NAN,
        _ => (1.0 + frac / 1024.0) * 2f64.powi(exp as i32 - 15),
    };
    if h & 0x8000 != 0 {
        -magnitude
    } else {
        magnitude
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_scalars() {
        assert_eq!(deserialize(&[0x18, 0x18]).unwrap(), AceValue::Int(24));
        assert_eq!(deserialize(&[0x20]).unwrap(), AceValue::Int(-1));
        assert_eq!(deserialize(&[0xf5]).unwrap(), AceValue::Bool(true));
        assert_eq!(
            deserialize(&[0xf9, 0x3e, 0x00]).unwrap(),
            AceValue::Float(1.5)
        );
        assert_eq!(
            deserialize(&[0x43, b'a', b'b', b'c']).unwrap(),
            AceValue::Str("abc".into())
        );
    }

    #[test]
    fn arrays_become_one_based_tables() {
        let AceValue::Table(t) = deserialize(&[0x82, 0x07, 0x08]).unwrap() else {
            panic!("expected a table")
        };
        assert_eq!(
            t.pairs,
            vec![
                (AceValue::Int(1), AceValue::Int(7)),
                (AceValue::Int(2), AceValue::Int(8))
            ]
        );
    }

    #[test]
    fn truncated_input_is_an_error() {
        assert!(deserialize(&[0x82, 0x07]).is_err());
    }
}
