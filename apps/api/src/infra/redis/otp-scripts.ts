// All state transitions for a challenge run together, including its retry budgets.
export const ISSUE_OTP = `
local function retry(key, fallback)
  local ttl = redis.call('TTL', key)
  if ttl > 0 then return ttl end
  return fallback
end
if tonumber(redis.call('GET', KEYS[4]) or '0') >= tonumber(ARGV[4]) then
  return {'hour', retry(KEYS[4], 3600)}
end
if #KEYS == 5 and tonumber(redis.call('GET', KEYS[5]) or '0') >= tonumber(ARGV[5]) then
  return {'day', retry(KEYS[5], 86400)}
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {'cooldown', retry(KEYS[2], tonumber(ARGV[3]))}
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[3])
redis.call('DEL', KEYS[3])
local function count(key, ttl)
  local n = redis.call('INCR', key)
  if n == 1 or redis.call('TTL', key) < 0 then redis.call('EXPIRE', key, ttl) end
end
count(KEYS[4], 3600)
if #KEYS == 5 then count(KEYS[5], 86400) end
return {'ok', tonumber(ARGV[3])}
`

export const CONSUME_OTP = `
local function locked()
  return {'locked', 0, math.max(1, redis.call('TTL', KEYS[3]))}
end
if #KEYS == 3 and tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[4]) then
  return locked()
end
local stored = redis.call('GET', KEYS[1])
if not stored then return {'no-code', 0, 0} end
local attempts = redis.call('INCR', KEYS[2])
if attempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
if attempts > tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return {'too-many', 0, 0}
end
-- Compare every hash byte; the optional suffix identifies the issuance.
local hash = string.sub(stored, 1, 64)
local diff = bit.bxor(string.len(hash), string.len(ARGV[1]))
for i = 1, 64 do
  diff = bit.bor(diff, bit.bxor(string.byte(hash, i) or 0, string.byte(ARGV[1], i) or 0))
end
if diff == 0 then
  redis.call('DEL', unpack(KEYS))
  return {'ok', 0, 0}
end
if #KEYS == 3 then
  local failures = redis.call('INCR', KEYS[3])
  if failures == 1 then redis.call('EXPIRE', KEYS[3], ARGV[5]) end
  if failures >= tonumber(ARGV[4]) then return locked() end
end
return {'mismatch', math.max(0, tonumber(ARGV[2]) - attempts), 0}
`

// A delayed SMS failure must not remove a newer challenge or its cooldown.
export const CANCEL_OTP = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1], KEYS[3]) end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`
