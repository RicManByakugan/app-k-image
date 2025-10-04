import { Component } from '@angular/core';
import { HeaderComponent } from '../../../shared/layout/auth/header/header.component';
import { FooterComponent } from '../../../shared/layout/auth/footer/footer.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [HeaderComponent, FooterComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {}
