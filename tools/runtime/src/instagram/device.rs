// Preserve the seeded device identifiers used by the previous SDK (Chance/MT19937).
// These are device labels, never cryptographic keys or authentication tokens.
struct Seeded {
    words: [u32; 624],
    index: usize,
}
impl Seeded {
    fn new(seed: &str) -> Self {
        let (hash, length) = seed
            .encode_utf16()
            .fold((0u32, 0u32), |(hash, length), ch| {
                (
                    hash.wrapping_mul(65_599).wrapping_add(u32::from(ch)),
                    length.wrapping_add(1),
                )
            });
        let mut words = [0; 624];
        words[0] = hash.wrapping_mul(length);
        for i in 1..624 {
            words[i] = (words[i - 1] ^ (words[i - 1] >> 30))
                .wrapping_mul(1_812_433_253)
                .wrapping_add(i as u32);
        }
        Self { words, index: 624 }
    }
    fn next(&mut self) -> u32 {
        if self.index == 624 {
            for i in 0..624 {
                let y = (self.words[i] & 0x8000_0000) | (self.words[(i + 1) % 624] & 0x7fff_ffff);
                self.words[i] = self.words[(i + 397) % 624]
                    ^ (y >> 1)
                    ^ if y & 1 == 1 { 0x9908_b0df } else { 0 };
            }
            self.index = 0;
        }
        let mut value = self.words[self.index];
        self.index += 1;
        value ^= value >> 11;
        value ^= (value << 7) & 0x9d2c_5680;
        value ^= (value << 15) & 0xefc6_0000;
        value ^ (value >> 18)
    }
    fn text(&mut self, pool: &[u8], length: usize) -> String {
        (0..length)
            .map(|_| {
                let index = (self.next() as u64 * pool.len() as u64) >> 32;
                pool[index as usize] as char
            })
            .collect()
    }
    fn guid(&mut self) -> String {
        let pool = b"abcdef1234567890";
        format!(
            "{}-{}-5{}-{}{}-{}",
            self.text(pool, 8),
            self.text(pool, 4),
            self.text(pool, 3),
            self.text(b"ab89", 1),
            self.text(pool, 3),
            self.text(pool, 12)
        )
    }
}

pub fn identifiers(seed: &str) -> (String, String, String) {
    let mut rng = Seeded::new(seed);
    rng.next(); // The SDK picks a device model before generating identifiers.
    let device_id = format!("android-{}", rng.text(b"abcdef0123456789", 16));
    (rng.guid(), rng.guid(), device_id)
}

pub fn pigeon_session(device_id: &str, now: u64) -> String {
    let window = now.saturating_add(600_000) / 1_200_000;
    Seeded::new(&format!("pigeonSessionId{device_id}{window}")).guid()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifiers_match_previous_typescript_sdk() {
        for (seed, uuid, phone, android) in [
            (
                "source:profile-123",
                "9dd1eefe-a562-588b-ab8e-61978afa3100",
                "b9e199eb-139d-51e7-975e-6c63264b41a4",
                "android-40dca286d0981087",
            ),
            (
                "example:profile-123",
                "1d234432-69bc-5528-9af8-3f5e8b341336",
                "9f5d1ebc-7580-5a1f-bf3a-4c6bbd73c12b",
                "android-271ed2fb6a71a3ea",
            ),
            (
                "unicode:профіль",
                "6b37e083-e95a-55de-9101-6079bbedb9f8",
                "6fc118c5-dc2b-5f19-8561-45a8a6a08ae5",
                "android-49f16d9ed0d64fee",
            ),
        ] {
            assert_eq!(
                identifiers(seed),
                (uuid.into(), phone.into(), android.into())
            );
        }
    }
    #[test]
    fn pigeon_session_matches_previous_sdk_and_is_stable_during_login() {
        let device = "android-40dca286d0981087";
        let now = 1_790_806_085_788;
        assert_eq!(
            pigeon_session(device, now),
            "b6691fe5-d1d7-5066-a6eb-efdf4b255627"
        );
        assert_eq!(
            pigeon_session(device, now),
            pigeon_session(device, now + 5000)
        );
    }
}
