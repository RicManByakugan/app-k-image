import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FunPopupComponent } from './fun-popup.component';

describe('FunPopupComponent', () => {
  let component: FunPopupComponent;
  let fixture: ComponentFixture<FunPopupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FunPopupComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FunPopupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
