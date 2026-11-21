package dev.quokkify.marketdesk.step;

public abstract class BaseSteps {

  protected final HealthSteps healthSteps = new HealthSteps();
  protected final AuthSteps authSteps = new AuthSteps();
  protected final LoginPageSteps loginPageSteps = new LoginPageSteps();
  protected final ProductSteps productSteps = new ProductSteps();
  protected final AiUsageSteps aiUsageSteps = new AiUsageSteps();
  protected final HermesLimitsSteps hermesLimitsSteps = new HermesLimitsSteps();
  protected final ListingSteps listingSteps = new ListingSteps();
  protected final MarketplaceSteps marketplaceSteps = new MarketplaceSteps();
  protected final MarketplacesPageSteps marketplacesPageSteps = new MarketplacesPageSteps();
}
