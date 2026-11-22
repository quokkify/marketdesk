package dev.quokkify.marketdesk.step;

public abstract class BaseSteps {

  protected final HealthSteps healthSteps = new HealthSteps();
  protected final AuthSteps authSteps = new AuthSteps();
  protected final LoginPageSteps loginPageSteps = new LoginPageSteps();
  protected final ProductSteps productSteps = new ProductSteps();
  protected final AiUsageSteps aiUsageSteps = new AiUsageSteps();
  protected final PriceResearchSteps priceResearchSteps = new PriceResearchSteps();
  protected final HermesLimitsSteps hermesLimitsSteps = new HermesLimitsSteps();
  protected final ListingSteps listingSteps = new ListingSteps();
  protected final MarketplaceSteps marketplaceSteps = new MarketplaceSteps();
  protected final ConversationSteps conversationSteps = new ConversationSteps();
  protected final MarketplacesPageSteps marketplacesPageSteps = new MarketplacesPageSteps();
  protected final HermesActivityPageSteps hermesActivityPageSteps = new HermesActivityPageSteps();
  protected final ProductDetailPageSteps productDetailPageSteps = new ProductDetailPageSteps();
  protected final ProductsPageSteps productsPageSteps = new ProductsPageSteps();
}
