use std::time::Instant;

pub struct RateLimiter {
    max_tokens: u32,
    refill_rate_per_sec: f64,
    tokens: f64,
    last_update: Instant,
}

impl RateLimiter {
    pub fn new(max_tokens: u32, refill_rate_per_sec: f64) -> Self {
        Self {
            max_tokens,
            refill_rate_per_sec,
            tokens: max_tokens as f64,
            last_update: Instant::now(),
        }
    }

    /// Try to consume 1 token. Returns true if allowed, false if rate limited.
    pub fn check_and_consume(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_update).as_secs_f64();
        self.last_update = now;

        self.tokens = (self.tokens + elapsed * self.refill_rate_per_sec).min(self.max_tokens as f64);

        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

pub struct PeerRateLimiters {
    pub update_limiter: RateLimiter,
    pub awareness_limiter: RateLimiter,
}

impl PeerRateLimiters {
    pub fn new() -> Self {
        Self {
            update_limiter: RateLimiter::new(60, 60.0),
            awareness_limiter: RateLimiter::new(30, 30.0),
        }
    }
}

impl Default for PeerRateLimiters {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_burst_and_exhaust() {
        let mut limiter = RateLimiter::new(5, 5.0);
        for _ in 0..5 {
            assert!(limiter.check_and_consume());
        }
        assert!(!limiter.check_and_consume());
    }
}

