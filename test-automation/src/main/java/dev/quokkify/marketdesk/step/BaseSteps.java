package dev.quokkify.marketdesk.step;

public abstract class BaseSteps {

  protected final HealthSteps healthSteps = new HealthSteps();
  protected final AuthSteps authSteps = new AuthSteps();
  protected final ProductSteps productSteps = new ProductSteps();
}
