# Product ranking and recommendations: refinement of stages 111–116

This is the current specification where it differs from [the original similarity design](112-1-algorithm.md) or [the original ranking design](114-1-ranking.md).

## Intent recovered from the six commits

| Commit | Contribution |
|---|---|
| `c02a6ed` | Accepted view/cart events, anonymous co-view history, sales counters, and nightly reconciliation. |
| `bf8b907` | Reliable buffered statistics and settlement hooks after committed payments. |
| `5b666e3` | Nightly behavioral similarities, detail-page alternatives, and cart rank fusion. |
| `0e0485d` | Filters before limits, strict buyability, deterministic neighbors, and cache invalidation. |
| `e646b9a` | Decayed Bayesian catalog ranking with category priors and daily Thompson exploration. |
| `cf1a032` | Authoritative settled sales, Tehran settlement dates, and availability after featured placement. |

The intended architecture is retained: inexpensive cached reads, real behavioral evidence, atomic nightly rebuilds, stable ordering during the day, editorial featured placement, and exploration for new products. Explicit user sorts still work. This refinement corrects the meaning of the evidence and gives the cart its own recommendation objective.

## Catalog: bounded preference evidence

The original `min(sold units + 0.3 × cart adds, detail views)` discarded real purchases without a detail visit. It also treated quantities as independent conversions and rewarded the cart and purchase stages twice.

For each product and Tehran calendar day:

```text
V = accepted detail views
C = accepted cart additions
P = distinct purchasing users
N = max(V, C, P)
R = P + 0.3 × max(C − P, 0)
w = 0.5 ^ (age_in_days / 10)
n = Σ(w × N)
r = Σ(w × R)
```

The inclusive window is reference day − 44 through reference day. Always `0 ≤ r ≤ n`. Construct the daily funnel before decay; observations on different days must not cancel one another. A direct purchase contributes one opportunity and one reward even with no page visit. A cart followed by a purchase contributes one reward. Buying 100 units, several sizes, or placing repeated orders supplies one buyer/product/day observation. A different buyer or a subsequent day supplies further evidence.

Purchase evidence comes from current successful, nonpending, noncanceled orders, so refunds and cancellations disappear on recompute. The earliest successful verification supplies the Tehran settlement day; wallet and legacy orders fall back to creation time. Payment attempts collapse before joining order items. Nonpositive quantities and missing product IDs supply no evidence. Public `products.sales` and historical daily unit counters retain their existing accounting meaning.

These aggregate stages cannot establish which anonymous viewer became which buyer. Browsing deduplication uses a rolling 24-hour window, while buyers use calendar days. `N` is a lower bound on opportunities and the cart residual approximates overlapping funnel stages. The score is therefore a **preference utility**, not a calibrated conversion probability. Missing detail visits can favor quick-add products; views collected while products are unavailable or purchase-locked can depress their utility after restocking. Accurate conversion estimation requires impression, availability-at-exposure, and attributable outcome data; do not display this score as a conversion percentage.

### Continuous priors without counting a product twice

Exclude the target product from both global and main-category totals. With `clamp(x) = min(0.5, max(0.005, x))`:

```text
g = clamp((global_peer_rewards + 25 × 0.02) / (global_peer_opportunities + 25))
p = clamp((category_peer_rewards + 300 × g) / (category_peer_opportunities + 300))
alpha = 25 × p + r
beta  = 25 × (1 − p) + n − r
score ~ Beta(alpha, beta), seeded by Tehran day + product UUID
```

The category weight grows continuously, reaching half at 300 peer opportunities. Crossing 300 no longer causes a sudden ranking change. Removing the target from the prior prevents its evidence from entering both prior and posterior. The 25-observation prior bounds cold-start uncertainty; daily seeded sampling preserves the original exploration behavior. Constants are conservative tunable defaults, not empirically optimal estimates.

Only ACTIVE products receive ranks. Availability and category purchase permissions remain display-time gates. Featured insertion is followed by a stable linear availability partition for smart sorting; explicit sorts preserve their existing behavior.

## Detail and cart: separate objectives

Co-views now require the same visitor to see both products on the **same Tehran day** within reference day − 59 through reference day. Repeated days from one visitor count once for a pair. A visitor who sees more than 30 distinct products in one day is excluded for that day, without discarding a loyal customer's other days.

Co-purchases use distinct products in paid, nonpending, noncanceled baskets of at most 12 distinct products. Lifetime purchase history is intentionally retained: sparse purchase evidence must survive the shorter view-log window. This means historical tastes can persist; introducing purchase decay requires evidence that freshness outweighs the loss of sparse associations.

For each signal, popularity is counted on the same eligible population as pair support:

```text
cosine(a,b) = support(a,b) / sqrt(popularity(a) × popularity(b))
view_score = view_cosine × co_view_support / (co_view_support + 5)
purchase_score = purchase_cosine × co_purchase_support / (co_purchase_support + 3)
detail_score = 0.35 × view_score + 0.65 × purchase_score
```

At least two independent co-view visitors or one paid basket are required. Support shrinkage reduces confidence in accidental perfect cosine from one basket. Repeated paid baskets remain evidence of purchasing association; they are not claimed to be independent people.

Each product retains the union of its best 20 detail candidates and best 20 positive purchase candidates, at most 40 rows. This prevents a strong set of viewed alternatives from exhausting the cart's candidate pool. Scores use PostgreSQL double precision. Ties use product UUIDs.

The existing endpoint accepts `context=cart` and up to 50 comma-separated UUIDs in `exclude`. Detail uses mixed scores. Cart requires positive purchase scores and filters the entire basket, availability, ACTIVE status, and category/main purchase permissions **before** taking eight results. A blocked detail-page anchor also requests strict buyable alternatives. No unsupported fallback products are invented.

Cart fusion retains up to three distinct anchors and four cards:

```text
fusion(candidate) = Σ 1 / (8 + eligible_rank_in_anchor_list)   # ranks start at 1
```

Each anchor contributes at most one vote per candidate. Excluded/unbuyable entries do not consume rank positions. The offset favors agreement across anchors over one isolated first-place candidate. Canonical summation and UUID ties make equivalent input lists produce the same order.

## Efficiency, publication, and caches

- Similarity expands pairs inside bounded visitor/day or basket arrays. Work is bounded by the sum of context sizes squared (sizes at most 30 and 12), avoiding a global quadratic self-join even when PostgreSQL statistics are stale.
- Ranking aggregates evidence in one SQL snapshot, computes priors in linear time, sorts once, and inserts in chunks of 500.
- Transaction-scoped advisory locks serialize each algorithm's rebuilds before reading its inputs. Atomic delete/insert publication preserves the previous snapshot on failure; readers never see a partial rebuild.
- Recommendation DTOs reuse the joined category and purchase state, removing two extra queries from an uncached read.
- Context and sorted/deduplicated basket exclusions are part of both server and client cache keys. Existing menu-version invalidation and client invalidation cover all contexts. HTTP revalidation retains ETag/304 behavior.

Migration `0024_early_enchantress.sql` widens the existing score and adds `purchase_score` with a zero default. Apply migrations before starting the updated API. Once all API replicas use the new version, run similarity recompute followed by menu-cache invalidation, or allow the next 03:41 Tehran job to do so. Existing detail recommendations retain the old score until then; cart recommendations remain empty until purchase scores are rebuilt. Startup catch-up may skip a job already completed that day, and an old replica can overwrite new purchase scores with defaults, so complete the rollout before recomputing. The ordinary ranking rebuild publishes the new catalog model. Validation uses disposable local databases and does not migrate the application database.

## Verification and practical limits

Regression suites cover numerical signal examples, bulk and repeated purchases, independent buyers, direct cart/purchase flows, refunds, time boundaries, prior continuity, deterministic sampling, concurrent rebuilds, failed publication rollback, context-specific candidate budgets, availability/exclusions before limits, cache behavior, and migrations. The similarity stress fixture includes 46,341 paired viewers and 46,341 paid baskets to exercise overflow and query-plan behavior.

These checks establish correctness and bounded behavior, not a measured conversion lift. To tune the constants, evaluate chronological held-out purchases (training data strictly earlier than evaluation), cart Recall@4/NDCG@4, recommendation coverage, and exposure concentration. Catalog evaluation needs randomized exposure or a controlled experiment because historical positions influence observed clicks. Monitor recommendation availability and p95 job/read duration alongside business outcomes. Keep stable daily seeds within each experiment variant so ranking randomness does not contaminate comparisons.
